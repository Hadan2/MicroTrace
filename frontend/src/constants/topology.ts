export const NODE_POS: Record<string, { x: number; y: number }> = {
  'api-gateway':   { x: 0.50, y: 0.08 },
  'auth-svc':      { x: 0.18, y: 0.35 },
  'order-svc':     { x: 0.78, y: 0.35 },
  'redis':         { x: 0.05, y: 0.66 },
  'payment-svc':   { x: 0.50, y: 0.64 },
  'inventory-svc': { x: 0.95, y: 0.66 },
  'notif-svc':     { x: 0.78, y: 0.93 },
  'postgres':      { x: 0.28, y: 0.93 },
  'kafka':         { x: 0.96, y: 0.96 },
  'stripe-api':    { x: 0.52, y: 0.93 },
}

export const INTERNAL_SERVICES = new Set([
  'api-gateway', 'auth-svc', 'order-svc', 'payment-svc', 'inventory-svc', 'notif-svc',
])
