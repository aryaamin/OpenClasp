import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';

describe('HTTP API', () => {
  it('serves health, readiness, and OpenAPI', async () => {
    const app = buildApi();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({
      status: 'ready',
    });
    expect(
      (await app.inject({ method: 'GET', url: '/extensions/trust/v0.1' })).json(),
    ).toMatchObject({ version: '0.1', transportsMessages: false });
    const specification = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    expect(specification.info.title).toBe('OpenClasp API');
    expect(specification.paths).toHaveProperty('/v0.1/risk/assess');
    await app.close();
  });

  it('isolates hosted dashboard and settings by authenticated operator', async () => {
    const calls: string[] = [];
    let storedProfile: any = {
      agentId: 'agent-a',
      projectId: 'project-a',
      name: 'Test agent',
      description: '',
      framework: 'Botpress',
      agentVersion: '1.0.0',
      agentMode: 'persistent_runtime',
      transport: 'direct_a2a',
      autoPublish: false,
      autoAcceptPolicy: 'off',
      autoAcceptTaskCategories: [],
      capabilities: [],
      limitations: [],
      identityMode: 'owner_managed',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const repository = {
      dashboard: async (operatorId: string) => {
        calls.push(`dashboard:${operatorId}`);
        return {
          agents: [],
          projects: [],
          installations: [],
          setupRequests: [],
          publications: [],
          interactions: [],
          federatedInteractions: [],
          liveSessions: [],
          hostedThreads: [],
          events: [],
          conflicts: [],
          receipts: [],
          profiles: [],
          counterpartyBriefs: [],
          completionReports: [],
          feedbackRequests: [],
          interactionFeedback: [],
          interactionConclusions: [],
          learningEligibility: [],
          profileDeltas: [],
          runtimes: [],
          accessTokens: [],
        };
      },
      getSettings: async (operatorId: string) => {
        calls.push(`settings:${operatorId}`);
        return {
          displayName: '',
          contributionEnabled: false,
          retentionDays: 30,
          evidenceSharing: 'ask' as const,
          rawConversationsStored: false as const,
        };
      },
      saveSettings: async (operatorId: string, value: any) => {
        calls.push(`save:${operatorId}`);
        return { ...value, rawConversationsStored: false as const };
      },
      upsert: async (_operatorId: string, kind: string, _recordId: string, payload: any) => {
        if (kind === 'agent_profile') storedProfile = payload;
      },
      list: async () => [
        { kind: 'agent_profile' as const, recordId: 'agent-a', payload: storedProfile },
        {
          kind: 'publication' as const,
          recordId: 'agent-a',
          payload: { agentId: 'agent-a', published: true },
        },
      ],
      publishAgent: async (_operatorId: string, card: any) => card,
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      resolveAgentReference: async () => undefined,
      searchPublishedAgents: async () => [],
      listContextualIntelligence: async () => [
        {
          agentId: 'agent-peer',
          agentVersion: '1.0.0',
          taskCategory: 'research',
          score: 0.8,
          confidence: {
            level: 'medium' as const,
            value: 0.5,
            evidenceCount: 4,
            effectiveSampleSize: 3,
          },
          trend: { direction: 'stable' as const, delta: 0 },
          strengths: [],
          risks: [],
          versionStatus: {
            currentVersion: '1.0.0',
            evidenceVersion: '1.0.0',
            status: 'current' as const,
          },
          source: 'private_verified_history' as const,
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      ],
      searchPersonalizedMarketplace: async () => [
        {
          card: { agentId: 'agent-peer', name: 'Peer' },
          taskCategory: 'research',
          match: { score: 0.7, label: 'possible', reasons: [] },
        },
      ],
      registerAgentRuntime: async (operatorId: string, agentId: string, endpoint: string) => {
        calls.push(`runtime:${operatorId}:${agentId}:${endpoint}`);
        return {
          agentId,
          endpoint,
          a2aEndpoint: endpoint,
          status: 'verified' as const,
          verifiedAt: new Date().toISOString(),
          verificationKey: 'public-key',
        };
      },
      touchAgentPresence: async (operatorId: string, agentId: string) => {
        calls.push(`heartbeat:${operatorId}:${agentId}`);
        return {
          status: 'online' as const,
          checkedAt: '2026-01-01T00:00:00.000Z',
        };
      },
      disableAgentRuntime: async (operatorId: string, agentId: string) => {
        calls.push(`disable-runtime:${operatorId}:${agentId}`);
        return { agentId, status: 'disabled' as const };
      },
      deleteAgent: async (operatorId: string, agentId: string) => {
        calls.push(`delete-agent:${operatorId}:${agentId}`);
        return { agentId, deleted: true as const, historyRetained: true as const };
      },
      listAgentAccessTokens: async (operatorId: string, agentId?: string) => {
        calls.push(`list-tokens:${operatorId}:${agentId ?? '*'}`);
        return [];
      },
      issueAgentAccessToken: async (
        operatorId: string,
        agentId: string,
        value: { name: string; expiresInDays: number },
      ) => {
        calls.push(`issue-token:${operatorId}:${agentId}:${value.name}:${value.expiresInDays}`);
        return {
          tokenId: 'abcdefghijklmnop',
          token: 'oc_at_abcdefghijklmnop.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
          agentId,
          name: value.name,
          scopes: ['mcp:access', 'runtime:connect'],
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2027-01-01T00:00:00.000Z',
        };
      },
      revokeAgentAccessToken: async (operatorId: string, agentId: string, tokenId: string) => {
        calls.push(`revoke-token:${operatorId}:${agentId}:${tokenId}`);
        return { tokenId, agentId, revokedAt: '2026-01-02T00:00:00.000Z' };
      },
      getCounterpartyBrief: async (operatorId: string, interactionId: string, agentId: string) => {
        calls.push(`brief:${operatorId}:${interactionId}:${agentId}`);
        return {
          briefId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          interactionId,
          contractHash: 'contract-hash',
          recipientAgentId: agentId,
          subjectAgentId: 'agent-b',
          taskCategory: 'recruiting',
          decision: 'CHALLENGE' as const,
          requirements: [],
          insights: [],
          relevantSampleSize: 0,
          historyConfidence: 0,
          subjectAgentVersion: '1.0.0',
          recommendedContractChanges: [],
          generatedAt: '2026-08-29T00:00:00.000Z',
          expiresAt: '2026-08-29T01:00:00.000Z',
        };
      },
      submitCompletionReport: async (
        operatorId: string,
        agentId: string,
        report: any,
        submissionMethod:
          'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
      ) => {
        calls.push(
          `completion:${operatorId}:${agentId}:${report.interactionId}:${submissionMethod}`,
        );
        return report;
      },
      recordSessionCompletionReport: async (token: string, report: any) => {
        calls.push(`session-completion:${token}:${report.interactionId}`);
        return report;
      },
      listFeedbackRequests: async (operatorId: string, agentId: string) => {
        calls.push(`feedback-requests:${operatorId}:${agentId}`);
        return [];
      },
      submitInteractionFeedback: async (
        operatorId: string,
        agentId: string,
        feedback: any,
        submissionMethod:
          'oauth_account' | 'oauth_installation' | 'agent_access_token' | 'runtime_session',
      ) => {
        calls.push(
          `feedback:${operatorId}:${agentId}:${feedback.interactionId}:${submissionMethod}`,
        );
        return { feedbackId: feedback.feedbackId, status: 'submitted' as const, revealed: false };
      },
      recordSessionFeedback: async (token: string, feedback: any) => {
        calls.push(`session-feedback:${token}:${feedback.interactionId}`);
        return { feedbackId: feedback.feedbackId, status: 'submitted' as const, revealed: false };
      },
      receiveTemporaryMessage: async (
        token: string,
        agentId: string,
        requestKey: string,
        content: string,
      ) => {
        calls.push(`temporary:${token}:${agentId}:${requestKey}:${content}`);
        return {
          message: {
            messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            interactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            senderAgentId: 'agent-peer',
            recipientAgentId: agentId,
            contentType: 'text/plain' as const,
            content,
            contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            delivery: 'delivered' as const,
            createdAt: new Date().toISOString(),
          },
          deduplicated: false,
        };
      },
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/v0.1/dashboard' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/dashboard',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/intelligence?agentId=agent-peer&taskCategory=research',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).json()[0],
    ).toMatchObject({ agentId: 'agent-peer', score: 0.8 });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/marketplace?agentId=agent-a&taskCategory=research',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).json()[0],
    ).toMatchObject({ match: { label: 'possible' } });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/settings',
          headers: { 'x-openclasp-operator': 'user-b' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v0.1/agents/agent-a/runtime',
          headers: { 'x-openclasp-operator': 'user-a' },
          payload: { endpoint: 'https://agent.example/openclasp' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls).toEqual([
      'dashboard:user-a',
      'settings:user-b',
      'runtime:user-a:agent-a:https://agent.example/openclasp',
    ]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/runtime/bootstrap',
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
            host: 'openclasp.example',
            'x-forwarded-proto': 'https',
          },
        })
      ).json(),
    ).toMatchObject({
      agentId: 'agent-a',
      openClaspUrl: 'https://openclasp.example',
      protocol: 'A2A/1.0',
    });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v0.1/runtime',
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
          payload: { endpoint: 'https://runtime.example/a2a' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe('runtime:user-a:agent-a:https://runtime.example/a2a');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v0.1/runtime',
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe('disable-runtime:user-a:agent-a');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v0.1/runtime/heartbeat',
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe('heartbeat:user-a:agent-a');
    const runtimeProfile = await app.inject({
      method: 'PUT',
      url: '/v0.1/runtime/profile',
      headers: {
        'x-openclasp-operator': 'user-a',
        'x-openclasp-bound-agent': 'agent-a',
        host: 'openclasp.example',
        'x-forwarded-proto': 'https',
      },
      payload: {
        description: 'Finds suitable candidates for open roles',
        capabilities: ['recruiting', 'candidate-screening', 'recruiting'],
        limitations: ['no-live-job-database'],
      },
    });
    expect(runtimeProfile.statusCode).toBe(200);
    expect(runtimeProfile.json()).toMatchObject({
      profile: {
        capabilities: ['recruiting', 'candidate-screening'],
        limitations: ['no-live-job-database'],
      },
      card: { capabilities: ['recruiting', 'candidate-screening'] },
    });
    expect(storedProfile.description).toBe('Finds suitable candidates for open roles');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v0.1/agents/agent-a',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).json(),
    ).toMatchObject({ agentId: 'agent-a', deleted: true, historyRetained: true });
    expect(calls.at(-1)).toBe('delete-agent:user-a:agent-a');
    const issuedToken = await app.inject({
      method: 'POST',
      url: '/v0.1/agents/agent-a/access-tokens',
      headers: { 'x-openclasp-operator': 'user-a' },
      payload: { name: 'Botpress', expiresInDays: 365 },
    });
    expect(issuedToken.statusCode).toBe(200);
    expect(issuedToken.json()).toMatchObject({
      agentId: 'agent-a',
      name: 'Botpress',
      scopes: ['mcp:access', 'runtime:connect'],
    });
    expect(calls.at(-1)).toBe('issue-token:user-a:agent-a:Botpress:365');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v0.1/agents/agent-a/access-tokens/abcdefghijklmnop',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe('revoke-token:user-a:agent-a:abcdefghijklmnop');
    const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v0.1/federated-interactions/${interactionId}/brief?agentId=agent-a`,
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).json(),
    ).toMatchObject({ recipientAgentId: 'agent-a', decision: 'CHALLENGE' });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v0.1/federated-interactions/${interactionId}/brief?agentId=agent-b`,
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
        })
      ).statusCode,
    ).toBe(403);
    const completionReport = {
      reportId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      interactionId,
      contractHash: 'contract-hash',
      reportingAgentId: 'agent-a',
      counterpartyAgentId: 'agent-b',
      agentVersion: '1.0.0',
      outcome: 'partial',
      summary: 'The counterparty answered but no matching role was available.',
      requestedOutcome: 'Find a backend role',
      criteria: [],
      completedAt: '2026-08-29T00:00:00.000Z',
      confidence: 0.9,
      dataSharingMode: 'structured_only',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v0.1/federated-interactions/${interactionId}/completion-reports`,
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
          payload: completionReport,
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe(`completion:user-a:agent-a:${interactionId}:oauth_installation`);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v0.1/federated-interactions/${interactionId}/completion-reports`,
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
          payload: { ...completionReport, rawTranscript: 'must never be accepted' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${interactionId}/completion-reports`,
          payload: completionReport,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${interactionId}/completion-reports`,
          headers: { authorization: 'Bearer scoped-session-token' },
          payload: completionReport,
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe(`session-completion:scoped-session-token:${interactionId}`);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/feedback-requests?agentId=agent-a',
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
        })
      ).statusCode,
    ).toBe(200);
    const interactionFeedback = {
      feedbackId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      interactionId,
      reviewerAgentId: 'agent-a',
      subjectAgentId: 'agent-b',
      reviewerAgentVersion: '1.0.0',
      ratings: {
        overall_satisfaction: 0.7,
        outcome_satisfaction: 0.6,
        communication: 0.9,
        timeliness: 0.8,
        scope_adherence: 0.6,
        evidence_quality: 0.7,
        correction_handling: 0.8,
        reliability: 0.75,
      },
      wouldWorkAgain: 'yes',
      confidence: 0.9,
      submittedAt: '2026-08-29T00:10:00.000Z',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v0.1/federated-interactions/${interactionId}/feedback`,
          headers: {
            'x-openclasp-operator': 'user-a',
            'x-openclasp-bound-agent': 'agent-a',
          },
          payload: interactionFeedback,
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe(`feedback:user-a:agent-a:${interactionId}:oauth_installation`);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${interactionId}/feedback`,
          headers: { authorization: 'Bearer scoped-session-token' },
          payload: interactionFeedback,
        })
      ).statusCode,
    ).toBe(200);
    expect(calls.at(-1)).toBe(`session-feedback:scoped-session-token:${interactionId}`);
    const providerConnection = await app.inject({
      method: 'POST',
      url: '/v0.1/provider-connections',
      headers: { 'x-openclasp-operator': 'user-a' },
      payload: {
        provider: 'botpress',
        agentName: 'Recruiting agent',
        projectName: 'Recruiting',
        description: 'Matches candidates with open roles',
        capabilities: ['candidate matching'],
        limitations: ['no final hiring decisions'],
        expiresInDays: 365,
      },
    });
    expect(providerConnection.statusCode).toBe(200);
    expect(providerConnection.json()).toMatchObject({
      agent: {
        name: 'Recruiting agent',
        framework: 'Botpress',
        identityMode: 'owner_managed',
      },
      accessToken: { name: 'Botpress', scopes: ['mcp:access', 'runtime:connect'] },
    });
    expect(calls.at(-1)).toMatch(/^issue-token:user-a:agent_.*:Botpress:365$/);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/a2a/temporary/agent-a',
          payload: {
            jsonrpc: '2.0',
            id: 'request-1',
            method: 'message/send',
            params: { message: { parts: [{ kind: 'text', text: 'Hello engineer' }] } },
          },
        })
      ).statusCode,
    ).toBe(401);
    const temporaryDelivery = await app.inject({
      method: 'POST',
      url: '/a2a/temporary/agent-a',
      headers: { authorization: 'Bearer scoped-token' },
      payload: {
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'message/send',
        params: { message: { parts: [{ kind: 'text', text: 'Hello engineer' }] } },
      },
    });
    expect(temporaryDelivery.statusCode).toBe(200);
    expect(temporaryDelivery.json()).toMatchObject({
      result: {
        task: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'submitted' },
        privacyMode: 'openclasp_hosted_temporary',
      },
    });
    expect(calls.at(-1)).toBe('temporary:scoped-token:agent-a:request-1:Hello engineer');
    await app.close();
  });

  it('publishes only an owned agent public card', async () => {
    const published: any[] = [];
    const repository = {
      dashboard: async () => ({}) as any,
      getSettings: async () => ({}) as any,
      saveSettings: async () => ({}) as any,
      upsert: async () => undefined,
      list: async () => [
        {
          kind: 'agent_profile' as const,
          recordId: 'agent-one',
          payload: {
            agentId: 'agent-one',
            projectId: 'secret-project',
            name: 'Research agent',
            description: 'Finds primary sources',
            framework: 'Codex',
            agentVersion: '1.0.0',
            a2aEndpoint: 'https://agent.example/a2a',
            capabilities: ['research'],
            limitations: ['no purchases'],
            identityMode: 'oauth_installation' as const,
            status: 'active' as const,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      publishAgent: async (_operatorId: string, card: any) => {
        published.push(card);
        return card;
      },
      unpublishAgent: async () => true,
      getPublishedAgent: async () => published[0],
      resolveAgentReference: async (reference: string) =>
        published[0]
          ? {
              reference,
              matchedBy: 'slug' as const,
              verified: true as const,
              card: published[0],
              resolvedAt: '2026-08-30T00:00:00.000Z',
            }
          : undefined,
      searchPublishedAgents: async () => published,
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/v0.1/agents/agent-one/publication',
      headers: { 'x-openclasp-operator': 'owner-one' },
      payload: { published: true },
    });
    expect(response.statusCode).toBe(200);
    expect(published[0]).toMatchObject({
      agentId: 'agent-one',
      capabilities: ['research'],
      assurance: 'oauth_authenticated',
    });
    expect(published[0]).not.toHaveProperty('projectId');
    expect(published[0]).not.toHaveProperty('operatorId');
    const publicCard = await app.inject({
      method: 'GET',
      url: '/agents/agent-one/card.json',
    });
    expect(publicCard.statusCode).toBe(200);
    expect(publicCard.json()).not.toHaveProperty('projectId');
    const a2aCard = await app.inject({
      method: 'GET',
      url: '/agents/agent-one/a2a-agent-card.json',
    });
    expect(a2aCard.statusCode).toBe(200);
    expect(a2aCard.json().supportedInterfaces[0]).toMatchObject({
      url: 'https://agent.example/a2a',
      protocolVersion: '1.0',
    });
    const resolution = await app.inject({
      method: 'GET',
      url: `/directory/resolve?reference=${encodeURIComponent(published[0].profileUrl)}`,
    });
    expect(resolution.statusCode).toBe(200);
    expect(resolution.json()).toMatchObject({ verified: true, card: { agentId: 'agent-one' } });
    const profile = await app.inject({ method: 'GET', url: `/a/${published[0].slug}` });
    expect(profile.statusCode).toBe(200);
    expect(profile.headers['content-type']).toContain('text/html');
    expect(profile.body).toContain('Account and agent ownership verified');
    const automation = await app.inject({
      method: 'PUT',
      url: '/v0.1/agents/agent-one/automation',
      headers: { 'x-openclasp-operator': 'owner-one' },
      payload: {
        a2aEndpoint: 'https://agent.example/a2a',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['research'],
      },
    });
    expect(automation.statusCode).toBe(200);
    expect(automation.json()).toMatchObject({
      autoPublish: true,
      autoAcceptPolicy: 'safe_matching',
    });
    await app.close();
  });

  it('accepts only structured live-session events at the reporting endpoint', async () => {
    const events: any[] = [];
    const repository = {
      dashboard: async () => ({}) as any,
      getSettings: async () => ({}) as any,
      saveSettings: async () => ({}) as any,
      upsert: async () => undefined,
      list: async () => [],
      publishAgent: async (_operatorId: string, card: any) => card,
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      resolveAgentReference: async () => undefined,
      searchPublishedAgents: async () => [],
      recordLiveSessionEvent: async (token: string, value: any) => {
        events.push({ token, value });
        return {
          recorded: true,
          deduplicated: false,
          eventId: value.eventId,
          attestation: {
            algorithm: 'Ed25519' as const,
            keyId: 'openclasp:test',
            value: 'signature',
            digest: 'digest',
          },
        };
      },
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(
      (await app.inject({ method: 'POST', url: `/sessions/${interactionId}/events` })).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${interactionId}/events`,
      headers: { authorization: 'Bearer live-session-token' },
      payload: {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        interactionId,
        agentId: 'agent-a',
        sequence: 1,
        type: 'message_sent',
        occurredAt: new Date().toISOString(),
        messageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        evidenceReferences: [],
        details: {},
      },
    });
    expect(response.statusCode).toBe(200);
    expect(events[0]).toMatchObject({
      token: 'live-session-token',
      value: { interactionId, agentId: 'agent-a', type: 'message_sent' },
    });
    const rawMessageAttempt = await app.inject({
      method: 'POST',
      url: `/sessions/${interactionId}/events`,
      headers: { authorization: 'Bearer live-session-token' },
      payload: {
        eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        interactionId,
        agentId: 'agent-a',
        sequence: 2,
        type: 'message_sent',
        occurredAt: new Date().toISOString(),
        details: { message: 'raw conversation text' },
      },
    });
    expect(rawMessageAttempt.statusCode).toBe(400);
    expect(events).toHaveLength(1);
    await app.close();
  });

  it('binds contract proposals and responses to the authenticated participating agent', async () => {
    const calls: any[] = [];
    const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const revisionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const contract = {
      protocolVersion: '0.1',
      interactionId,
      purpose: 'Buy paper',
      parties: ['agent-a', 'agent-b'],
      taskCategory: 'procurement',
      requestedOutcome: 'Five tonnes delivered',
      successCriteria: ['80 GSM verified', 'Delivered on time'],
      allowedActions: ['negotiate'],
      prohibitedActions: ['exceed_budget'],
      allowedData: [],
      prohibitedData: ['credentials'],
      evidenceRequirements: ['invoice'],
      delegationRules: ['explicit_contract_scope'],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent',
      retentionDays: 30,
      completionConditions: ['delivery accepted'],
      cancellationConditions: ['either party before acceptance'],
      signatures: {},
    };
    const repository: any = {
      dashboard: async () => ({}),
      getSettings: async () => ({}),
      saveSettings: async () => ({}),
      upsert: async () => undefined,
      list: async () => [],
      publishAgent: async (_operatorId: string, card: any) => card,
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      resolveAgentReference: async () => undefined,
      searchPublishedAgents: async () => [],
      proposeContractRevision: async (...args: any[]) => {
        calls.push(['propose', ...args]);
        return { interactionId, status: 'pending' };
      },
      respondToContractRevision: async (...args: any[]) => {
        calls.push(['respond', ...args]);
        return { interactionId, status: 'active' };
      },
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const headers = {
      'x-openclasp-operator': 'owner-a',
      'x-openclasp-bound-agent': 'agent-a',
      'x-openclasp-credential-type': 'agent_access_token',
    };
    const proposed = await app.inject({
      method: 'POST',
      url: `/v0.1/federated-interactions/${interactionId}/contract-proposals`,
      headers,
      payload: { agentId: 'agent-a', expectedTermsHash: 'old-hash', contract },
    });
    expect(proposed.statusCode).toBe(200);
    expect(calls[0]).toMatchObject([
      'propose',
      'owner-a',
      interactionId,
      'agent-a',
      contract,
      'old-hash',
      'oauth_installation',
    ]);
    const accepted = await app.inject({
      method: 'POST',
      url: `/v0.1/federated-interactions/${interactionId}/contract-proposals/${revisionId}/respond`,
      headers,
      payload: { agentId: 'agent-a', decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(calls[1]).toEqual([
      'respond',
      'owner-a',
      interactionId,
      'agent-a',
      revisionId,
      'accept',
      'oauth_installation',
    ]);
    const impersonation = await app.inject({
      method: 'POST',
      url: `/v0.1/federated-interactions/${interactionId}/contract-proposals`,
      headers,
      payload: { agentId: 'agent-b', contract },
    });
    expect(impersonation.statusCode).toBe(403);
    await app.close();
  });
});
