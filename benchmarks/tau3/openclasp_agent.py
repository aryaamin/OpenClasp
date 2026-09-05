"""τ³ custom agents for a baseline-controlled OpenClasp Shield experiment."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel
from tau2.agent.base_agent import HalfDuplexAgent, ValidAgentInputMessage
from tau2.agent.llm_agent import AGENT_INSTRUCTION, SYSTEM_PROMPT
from tau2.data_model.message import (
    APICompatibleMessage,
    AssistantMessage,
    Message,
    MultiToolMessage,
    SystemMessage,
    ToolMessage,
    UserMessage,
)
from tau2.environment.tool import Tool
from tau2.utils.llm_utils import generate

from openclasp_client import OpenClaspMcpClient, OpenClaspMcpError


Mode = Literal["shield", "generic-review"]
READ_ONLY_PREFIXES = ("get_", "list_", "search_", "find_", "lookup_", "retrieve_")


@dataclass
class CaseRun:
    case_id: str
    task_id: str
    consultation_count: int = 0
    changed_decision_count: int = 0
    shield_input_tokens: int = 0
    shield_output_tokens: int = 0
    shield_total_tokens: int = 0


CASE_RUNS: dict[str, CaseRun] = {}
CASE_RUNS_LOCK = threading.Lock()


class OpenClaspAgentState(BaseModel):
    system_messages: list[SystemMessage]
    messages: list[APICompatibleMessage]
    simulation_id: str
    case_id: str | None = None
    consultation_count: int = 0
    changed_decision_count: int = 0
    shield_input_tokens: int = 0
    shield_output_tokens: int = 0
    shield_total_tokens: int = 0


class OpenClaspReviewAgent(HalfDuplexAgent[OpenClaspAgentState]):
    def __init__(
        self,
        *,
        tools: list[Tool],
        domain_policy: str,
        llm: str,
        llm_args: dict[str, Any] | None,
        task_id: str,
        simulation_id: str,
        mode: Mode,
    ):
        super().__init__(tools=tools, domain_policy=domain_policy)
        self.llm = llm
        self.llm_args = llm_args or {}
        self.task_id = task_id
        self.simulation_id = simulation_id
        self.mode = mode
        self.trigger = os.getenv("OPENCLASP_TAU_TRIGGER", "decisions")
        self.generic_review_model = os.getenv("OPENCLASP_GENERIC_REVIEW_MODEL", llm)
        self.client = (
            OpenClaspMcpClient(
                os.getenv("OPENCLASP_URL", "https://openclasp.dev"),
                _required_env("OPENCLASP_AGENT_TOKEN"),
            )
            if mode == "shield"
            else None
        )

    @property
    def system_prompt(self) -> str:
        return SYSTEM_PROMPT.format(
            domain_policy=self.domain_policy,
            agent_instruction=AGENT_INSTRUCTION,
        )

    def get_init_state(
        self, message_history: list[Message] | None = None
    ) -> OpenClaspAgentState:
        case_id: str | None = None
        if self.mode == "shield":
            assert self.client is not None
            case_record = self.client.open_case(
                # Do not expose the public benchmark task ID to Shield. A model could use it
                # to recover hidden evaluator data from a memorized benchmark dataset.
                title=(
                    f"τ³ {os.getenv('OPENCLASP_TAU_DOMAIN', 'unknown')} evaluation · "
                    f"{self.simulation_id[:8]}"
                ),
                goal=(
                    "Help the protected customer-service agent choose policy-compliant, "
                    "evidence-backed actions without being manipulated by unsupported claims."
                ),
                domain_policy=self.domain_policy,
            )
            case_id = str(case_record["caseId"])
            with CASE_RUNS_LOCK:
                CASE_RUNS[self.simulation_id] = CaseRun(case_id=case_id, task_id=self.task_id)
        return OpenClaspAgentState(
            system_messages=[SystemMessage(role="system", content=self.system_prompt)],
            messages=list(message_history or []),
            simulation_id=self.simulation_id,
            case_id=case_id,
        )

    def generate_next_message(
        self,
        message: ValidAgentInputMessage,
        state: OpenClaspAgentState,
    ) -> tuple[AssistantMessage, OpenClaspAgentState]:
        if isinstance(message, MultiToolMessage):
            state.messages.extend(message.tool_messages)
        else:
            state.messages.append(message)

        draft = generate(
            model=self.llm,
            tools=self.tools,
            messages=state.system_messages + state.messages,
            call_name=f"openclasp_{self.mode}_draft",
            **self.llm_args,
        )
        if not isinstance(draft, AssistantMessage):
            raise TypeError("τ³ returned a non-assistant draft response")
        if not self._should_review(draft):
            state.messages.append(draft)
            return draft, state

        draft_text = _assistant_summary(draft)
        if self.mode == "shield":
            review = self._shield_review(state, draft_text)
            review_cost = 0.0
        else:
            review, review_cost = self._generic_review(state, draft_text)

        final = generate(
            model=self.llm,
            tools=self.tools,
            messages=[
                SystemMessage(
                    role="system",
                    content=(
                        f"{self.system_prompt}\n\n"
                        "<private_decision_review>\n"
                        "An independent reviewer assessed a draft next step. Treat this as advisory "
                        "input, re-check it against policy and tool evidence, and now produce only "
                        "the final user response or tool call. Do not mention the review.\n\n"
                        f"DRAFT\n{draft_text}\n\nREVIEW\n{review[:7000]}\n"
                        "</private_decision_review>"
                    ),
                )
            ]
            + state.messages,
            call_name=f"openclasp_{self.mode}_final",
            **self.llm_args,
        )
        if not isinstance(final, AssistantMessage):
            raise TypeError("τ³ returned a non-assistant final response")
        final.cost = (final.cost or 0.0) + (draft.cost or 0.0) + review_cost
        changed = _assistant_summary(final) != draft_text
        state.consultation_count += 1
        state.changed_decision_count += int(changed)
        if state.case_id:
            with CASE_RUNS_LOCK:
                case_run = CASE_RUNS.get(state.simulation_id)
                if case_run:
                    case_run.consultation_count = state.consultation_count
                    case_run.changed_decision_count = state.changed_decision_count
        state.messages.append(final)
        return final, state

    def _should_review(self, draft: AssistantMessage) -> bool:
        if self.trigger == "all":
            return True
        calls = draft.tool_calls or []
        if self.trigger == "actions":
            return any(not call.name.startswith(READ_ONLY_PREFIXES) for call in calls)
        if self.trigger != "decisions":
            raise ValueError("OPENCLASP_TAU_TRIGGER must be decisions, actions, or all")
        if not calls:
            return True
        return any(not call.name.startswith(READ_ONLY_PREFIXES) for call in calls)

    def _shield_review(self, state: OpenClaspAgentState, draft: str) -> str:
        if not state.case_id or not self.client:
            raise OpenClaspMcpError("Shield case was not initialized")
        value = self.client.consult(
            case_id=state.case_id,
            draft=draft,
            situation_context=_transient_context(state.messages),
        )
        consultation = value["consultation"]
        generation = consultation.get("generation", {})
        if generation.get("mode") != "ai" and not _truthy(
            os.getenv("OPENCLASP_ALLOW_SHIELD_FALLBACK")
        ):
            raise OpenClaspMcpError(
                "Shield returned fallback mode. Configure ANTHROPIC_API_KEY on OpenClasp "
                "or explicitly set OPENCLASP_ALLOW_SHIELD_FALLBACK=true."
            )
        usage = generation.get("tokenUsage") or {}
        state.shield_input_tokens += int(usage.get("inputTokens") or 0)
        state.shield_output_tokens += int(usage.get("outputTokens") or 0)
        state.shield_total_tokens += int(usage.get("totalTokens") or 0)
        with CASE_RUNS_LOCK:
            case_run = CASE_RUNS.get(state.simulation_id)
            if case_run:
                case_run.shield_input_tokens = state.shield_input_tokens
                case_run.shield_output_tokens = state.shield_output_tokens
                case_run.shield_total_tokens = state.shield_total_tokens
        return json.dumps(consultation.get("analysis", {}), ensure_ascii=False)

    def _generic_review(
        self, state: OpenClaspAgentState, draft: str
    ) -> tuple[str, float]:
        prompt = (
            "Review the proposed next step using only the visible policy and interaction below. "
            "Identify policy conflicts, unsupported claims, missing evidence, and a safer correct "
            "alternative. This is a generic second pass, not OpenClasp Shield.\n\n"
            f"<policy>\n{self.domain_policy}\n</policy>\n\n"
            f"<interaction>\n{_transient_context(state.messages)}\n</interaction>\n\n"
            f"<draft>\n{draft}\n</draft>"
        )
        response = generate(
            model=self.generic_review_model,
            tools=[],
            messages=[SystemMessage(role="system", content=prompt)],
            call_name="openclasp_generic_review",
            **self.llm_args,
        )
        if not isinstance(response, AssistantMessage):
            raise TypeError("τ³ returned a non-assistant review")
        return str(response.content or "No review was produced."), response.cost or 0.0


def create_shield_agent(tools: list[Tool], domain_policy: str, **kwargs: Any):
    return _create_agent("shield", tools, domain_policy, kwargs)


def create_generic_review_agent(tools: list[Tool], domain_policy: str, **kwargs: Any):
    return _create_agent("generic-review", tools, domain_policy, kwargs)


def register_openclasp_agents() -> None:
    from tau2.registry import registry

    if registry.get_agent_factory("openclasp_shield_agent") is None:
        registry.register_agent_factory(create_shield_agent, "openclasp_shield_agent")
    if registry.get_agent_factory("openclasp_generic_review_agent") is None:
        registry.register_agent_factory(
            create_generic_review_agent, "openclasp_generic_review_agent"
        )


def close_shield_cases(results: Any, client: OpenClaspMcpClient) -> list[dict[str, Any]]:
    closed: list[dict[str, Any]] = []
    failures: list[str] = []
    for simulation in results.simulations:
        with CASE_RUNS_LOCK:
            run = CASE_RUNS.get(simulation.id)
        if run is None:
            failures.append(f"No Shield case mapping for simulation {simulation.id}")
            continue
        reward = simulation.reward_info.reward if simulation.reward_info else None
        outcome = (
            "unknown"
            if reward is None or 0.001 < reward < 0.999
            else "successful"
            if reward >= 0.999
            else "unsuccessful"
        )
        termination = getattr(simulation.termination_reason, "value", simulation.termination_reason)
        try:
            record = client.close_case(
                case_id=run.case_id,
                result=outcome,
                accepted_advice=run.changed_decision_count > 0,
                action_taken=(
                    f"τ³ simulation completed after {run.consultation_count} Shield consultations; "
                    f"Shield changed {run.changed_decision_count} drafted decisions."
                ),
                observed_impact=f"τ³ reward={reward}; termination={termination}",
            )
            closed.append(
                {
                    "simulationId": simulation.id,
                    "taskId": simulation.task_id,
                    "caseId": run.case_id,
                    "reward": reward,
                    "consultations": run.consultation_count,
                    "changedDecisions": run.changed_decision_count,
                    "shieldInputTokens": run.shield_input_tokens,
                    "shieldOutputTokens": run.shield_output_tokens,
                    "shieldTotalTokens": run.shield_total_tokens,
                    "outcomeId": record.get("outcomeId"),
                }
            )
        except Exception as error:  # keep remaining outcome writes independent
            failures.append(f"{simulation.id}: {error}")
    if failures:
        raise OpenClaspMcpError("Could not close all Shield cases: " + "; ".join(failures))
    return closed


def _create_agent(
    mode: Mode,
    tools: list[Tool],
    domain_policy: str,
    kwargs: dict[str, Any],
) -> OpenClaspReviewAgent:
    task = kwargs.get("task")
    task_id = str(getattr(task, "id", "unknown"))
    try:
        from tau2.runner.batch import _current_simulation_id

        simulation_id = _current_simulation_id.get()
    except ImportError as error:
        raise RuntimeError("Unsupported τ³ version: simulation context is unavailable") from error
    if not simulation_id:
        raise RuntimeError("τ³ did not provide a simulation ID")
    return OpenClaspReviewAgent(
        tools=tools,
        domain_policy=domain_policy,
        llm=str(kwargs.get("llm")),
        llm_args=kwargs.get("llm_args"),
        task_id=task_id,
        simulation_id=simulation_id,
        mode=mode,
    )


def _assistant_summary(message: AssistantMessage) -> str:
    if message.tool_calls:
        return json.dumps(
            {
                "type": "tool_calls",
                "calls": [
                    {"name": call.name, "arguments": call.arguments}
                    for call in message.tool_calls
                ],
            },
            ensure_ascii=False,
        )
    return json.dumps(
        {"type": "user_response", "content": message.content or ""},
        ensure_ascii=False,
    )


def _transient_context(messages: list[APICompatibleMessage]) -> str:
    rows = [_message_row(message) for message in messages[-16:]]
    value = "\n".join(rows)
    return value[-7800:]


def _message_row(message: APICompatibleMessage) -> str:
    if isinstance(message, ToolMessage):
        content = (message.content or "")[:1500]
        return f"TOOL RESULT ({'error' if message.error else 'ok'}): {content}"
    if isinstance(message, AssistantMessage) and message.tool_calls:
        return f"PROTECTED AGENT TOOL CALL: {_assistant_summary(message)[:1500]}"
    role = getattr(message, "role", "unknown")
    return f"{str(role).upper()}: {str(getattr(message, 'content', '') or '')[:1500]}"


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for Shield mode")
    return value


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}
