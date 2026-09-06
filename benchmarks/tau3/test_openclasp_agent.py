from __future__ import annotations

import unittest
from unittest.mock import patch

from tau2.data_model.message import AssistantMessage, SystemMessage, UserMessage

from openclasp_agent import OpenClaspAgentState, OpenClaspReviewAgent


class GenericReviewTests(unittest.TestCase):
    def test_anthropic_review_has_a_non_system_message(self):
        captured = []

        def fake_generate(**kwargs):
            captured.extend(kwargs["messages"])
            return AssistantMessage(role="assistant", content="Review result", cost=0.01)

        agent = OpenClaspReviewAgent(
            tools=[],
            domain_policy="Visible policy",
            llm="claude-sonnet-5",
            llm_args={},
            task_id="0",
            simulation_id="simulation-id",
            mode="generic-review",
        )
        state = OpenClaspAgentState(
            system_messages=[SystemMessage(role="system", content=agent.system_prompt)],
            messages=[UserMessage(role="user", content="Please cancel it")],
            simulation_id="simulation-id",
        )

        with patch("openclasp_agent.generate", side_effect=fake_generate):
            result, cost = agent._generic_review(state, '{"type":"user_response"}')

        self.assertEqual(result, "Review result")
        self.assertEqual(cost, 0.01)
        self.assertTrue(any(isinstance(message, UserMessage) for message in captured))


if __name__ == "__main__":
    unittest.main()
