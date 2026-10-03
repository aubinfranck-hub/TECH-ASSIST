/** Client Jèko (Mobile Money : Wave, Orange, MTN, Moov, Djamo) — https://developer.jeko.africa */

export const JEKO_METHODS = ['wave', 'orange', 'mtn', 'moov', 'djamo'] as const;
export type JekoMethod = (typeof JEKO_METHODS)[number];

export function jekoConfigured(): boolean {
  return Boolean(process.env.JEKO_API_KEY && process.env.JEKO_API_KEY_ID && process.env.JEKO_STORE_ID && process.env.PAYMENT_WEBHOOK_SECRET);
}

export class JekoError extends Error {}

/**
 * Crée la demande de paiement : le client est redirigé vers `redirectUrl` pour payer avec sa méthode.
 * `reference` = identifiant de la commande Tech Assist, renvoyé tel quel dans la notification.
 */
export async function createJekoPayment(
  input: { orderId: string; amountFcfa: number; method: JekoMethod },
  fetchImpl: typeof fetch = fetch,
): Promise<{ redirectUrl: string; id: string }> {
  const web = (process.env.PUBLIC_WEB_URL ?? '').replace(/\/$/, '');
  const base = (process.env.JEKO_API_URL ?? 'https://api.jeko.africa').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetchImpl(`${base}/partner_api/payment_requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.JEKO_API_KEY!,
        'X-API-KEY-ID': process.env.JEKO_API_KEY_ID!,
      },
      body: JSON.stringify({
        storeId: process.env.JEKO_STORE_ID,
        amountCents: input.amountFcfa * 100, // 100 centimes = 1 XOF
        currency: 'XOF',
        reference: input.orderId,
        paymentDetails: {
          type: 'redirect',
          data: {
            paymentMethod: input.method,
            successUrl: `${web}/paiement?statut=ok`,
            errorUrl: `${web}/paiement?statut=erreur`,
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new JekoError('Le service de paiement ne répond pas. Réessayez dans un instant.');
  }
  const data = (await res.json().catch(() => null)) as { id?: string; redirectUrl?: string; errorReason?: string | null } | null;
  if (!res.ok || !data?.redirectUrl) {
    console.error('[jeko] création du paiement refusée', res.status, data?.errorReason ?? '');
    throw new JekoError('Le paiement n’a pas pu être créé. Essayez une autre méthode ou réessayez.');
  }
  return { redirectUrl: data.redirectUrl, id: data.id ?? '' };
}
