import * as sdk from '@botpress/sdk';

const ProfileSchema = sdk.z
  .object({
    description: sdk.z.string().trim().min(1).max(500),
    framework: sdk.z.string().trim().min(1).max(100),
    agentVersion: sdk.z.string().trim().min(1).max(100),
    modelProvider: sdk.z.string().trim().min(1).max(100).optional(),
    modelName: sdk.z.string().trim().min(1).max(100).optional(),
    capabilities: sdk.z.array(sdk.z.string().trim().min(1).max(100)).min(1).max(20),
    limitations: sdk.z.array(sdk.z.string().trim().min(1).max(300)).max(20),
  })
  .strict();

export type AgentProfile = sdk.z.infer<typeof ProfileSchema>;

export function parseAgentProfile(value: string): AgentProfile {
  const marker = 'OPENCLASP_PROFILE';
  const markerIndex = value.indexOf(marker);
  const source = markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Bot did not return an OpenClasp profile');
  return ProfileSchema.parse(JSON.parse(source.slice(start, end + 1)));
}
