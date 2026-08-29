import { handleCallback } from '@vercel/queue';
import { z } from 'zod';
import { HostedRepository } from '../packages/persistence/src/hosted.js';

const repository = process.env.DATABASE_URL
  ? new HostedRepository(process.env.DATABASE_URL)
  : undefined;
const QueueMessageSchema = z.object({ messageId: z.string().uuid() });

export const POST = handleCallback<{ messageId: string }>(
  async (message, metadata) => {
    if (!repository) throw new Error('Hosted persistence is not configured');
    const value = QueueMessageSchema.parse(message);
    if (metadata.deliveryCount > 10) {
      await repository.abandonGatewayDelivery(
        value.messageId,
        `Automatic delivery abandoned after ${metadata.deliveryCount} attempts`,
      );
      return;
    }
    await repository.deliverGatewayMessage(value.messageId);
  },
  {
    visibilityTimeoutSeconds: 30,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(300, 2 ** Math.min(metadata.deliveryCount, 6) * 5),
    }),
  },
);
