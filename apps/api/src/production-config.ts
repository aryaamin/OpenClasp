export type ProductionComponent = 'api' | 'auth' | 'cron' | 'mcp';

const sharedVariables = [
  'AUTH0_DOMAIN',
  'AUTH0_CLIENT_ID',
  'AUTH0_AUDIENCE',
  'OPENCLASP_PUBLIC_URL',
] as const;

export function productionConfigurationErrors(
  component: ProductionComponent,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (environment.VERCEL_ENV !== 'production' && environment.NODE_ENV !== 'production') return [];
  const required = new Set<string>(sharedVariables);
  required.add('DATABASE_URL');
  if (component !== 'auth') required.add('OPENCLASP_RELAY_ENCRYPTION_KEY');
  if (component === 'cron') required.add('CRON_SECRET');
  const errors = [...required]
    .filter((name) => !environment[name]?.trim())
    .map((name) => `${name} is required`);
  const publicUrl = environment.OPENCLASP_PUBLIC_URL;
  if (publicUrl) {
    try {
      if (new URL(publicUrl).protocol !== 'https:')
        errors.push('OPENCLASP_PUBLIC_URL must use HTTPS');
    } catch {
      errors.push('OPENCLASP_PUBLIC_URL must be a valid URL');
    }
  }
  if (
    component !== 'auth' &&
    environment.OPENCLASP_RELAY_ENCRYPTION_KEY &&
    environment.OPENCLASP_RELAY_ENCRYPTION_KEY.length < 32
  )
    errors.push('OPENCLASP_RELAY_ENCRYPTION_KEY must contain at least 32 characters');
  if (component === 'cron' && environment.CRON_SECRET && environment.CRON_SECRET.length < 32)
    errors.push('CRON_SECRET must contain at least 32 characters');
  return errors;
}

export function assertProductionConfiguration(component: ProductionComponent): void {
  const errors = productionConfigurationErrors(component);
  if (errors.length) throw new Error(`Unsafe production configuration: ${errors.join('; ')}`);
}
