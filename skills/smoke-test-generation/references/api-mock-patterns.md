# API Mock Patterns

MSW (Mock Service Worker) handler templates for every paid external service used in Household App Infrastructure apps. Tests must never call real paid APIs.

---

## MSW Setup

MSW intercepts outgoing HTTP requests at the network level. In Node.js (Vitest), use `msw/node`. In the browser (Playwright), use `msw/browser`.

```bash
npm install -D msw
npx msw init public/ --save  # For browser (Playwright)
```

---

## Anthropic Mock

Intercepts calls to `https://api.anthropic.com`.

```typescript
// tests/mocks/handlers/anthropic.ts
import { http, HttpResponse } from 'msw'

const ANTHROPIC_API = 'https://api.anthropic.com'

export const anthropicHandlers = [
  // Non-streaming: POST /v1/messages
  http.post(`${ANTHROPIC_API}/v1/messages`, () => {
    return HttpResponse.json({
      id: 'msg_mock_01',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Mock response from Anthropic. This is a test.',
        },
      ],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 12,
      },
    })
  }),

  // Streaming: POST /v1/messages with stream=true
  // MSW v2 supports streaming via ReadableStream
  http.post(`${ANTHROPIC_API}/v1/messages`, async ({ request }) => {
    const body = await request.json() as { stream?: boolean }
    if (!body.stream) return  // Let non-streaming handler above take it

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const events = [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_mock_stream","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Mock streaming response."}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]
        for (const event of events) {
          controller.enqueue(encoder.encode(event))
        }
        controller.close()
      },
    })

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  }),
]

// Override for error scenarios in specific tests:
// server.use(anthropicErrorHandler)
export const anthropicErrorHandler = http.post(`${ANTHROPIC_API}/v1/messages`, () => {
  return HttpResponse.json(
    { type: 'error', error: { type: 'overloaded_error', message: 'Service overloaded' } },
    { status: 529 }
  )
})

export const anthropicRateLimitHandler = http.post(`${ANTHROPIC_API}/v1/messages`, () => {
  return HttpResponse.json(
    { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
    { status: 429 }
  )
})
```

---

## Resend Mock

Intercepts calls to `https://api.resend.com`.

```typescript
// tests/mocks/handlers/resend.ts
import { http, HttpResponse } from 'msw'

const RESEND_API = 'https://api.resend.com'

export const resendHandlers = [
  // Send email
  http.post(`${RESEND_API}/emails`, () => {
    return HttpResponse.json({
      id: 'mock-email-id-00000000',
    })
  }),

  // Get email by ID
  http.get(`${RESEND_API}/emails/:id`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      object: 'email',
      to: ['test@example.com'],
      from: 'test@example.com',
      subject: 'Mock Email',
      html: '<p>Mock email body</p>',
      text: 'Mock email body',
      created_at: new Date().toISOString(),
    })
  }),
]

// Override for error scenarios:
export const resendErrorHandler = http.post(`${RESEND_API}/emails`, () => {
  return HttpResponse.json(
    { name: 'validation_error', message: 'Invalid from address', statusCode: 422 },
    { status: 422 }
  )
})
```

---

## OpenAI Mock

```typescript
// tests/mocks/handlers/openai.ts
import { http, HttpResponse } from 'msw'

const OPENAI_API = 'https://api.openai.com'

export const openaiHandlers = [
  http.post(`${OPENAI_API}/v1/chat/completions`, () => {
    return HttpResponse.json({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Mock response from OpenAI. This is a test.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 12,
        total_tokens: 22,
      },
    })
  }),
]
```

---

## Stripe Mock

```typescript
// tests/mocks/handlers/stripe.ts
import { http, HttpResponse } from 'msw'

const STRIPE_API = 'https://api.stripe.com'

export const stripeHandlers = [
  // Create payment intent
  http.post(`${STRIPE_API}/v1/payment_intents`, () => {
    return HttpResponse.json({
      id: 'pi_mock_00000000',
      object: 'payment_intent',
      amount: 2000,
      currency: 'gbp',
      status: 'requires_payment_method',
      client_secret: 'pi_mock_00000000_secret_mock',
    })
  }),

  // Create customer
  http.post(`${STRIPE_API}/v1/customers`, () => {
    return HttpResponse.json({
      id: 'cus_mock_00000000',
      object: 'customer',
      email: 'test@example.com',
    })
  }),
]
```

---

## Supabase Mock (Vitest Only)

For Vitest tests, mock the Supabase client module directly rather than intercepting HTTP, since the Supabase client uses its own connection pooling.

```typescript
// tests/mocks/supabase.ts
import { vi } from 'vitest'

// Create a chainable mock that returns itself for .from().select().eq() chains
const createChainableMock = () => {
  const mock: Record<string, unknown> = {}
  const chainMethods = ['from', 'select', 'insert', 'update', 'delete', 'upsert',
                        'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
                        'in', 'is', 'not', 'or', 'filter', 'order', 'limit',
                        'offset', 'range', 'schema']

  for (const method of chainMethods) {
    mock[method] = vi.fn().mockReturnThis()
  }

  // Terminal methods return promises
  mock['single'] = vi.fn().mockResolvedValue({ data: null, error: null })
  mock['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
  mock['then'] = undefined  // Not a promise itself

  return mock
}

export const mockSupabase = {
  ...createChainableMock(),
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'test-user-id' }, access_token: 'mock-token' } },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
  storage: {
    from: vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: 'mock/path' }, error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/mock' } }),
    }),
  },
}

// Usage in test file:
// vi.mock('@/lib/supabase/client', () => ({ supabase: mockSupabase }))
```

---

## Using Handlers in Specific Tests

To override the default mock for a specific test case:

```typescript
import { server } from '../mocks/server'
import { anthropicErrorHandler } from '../mocks/handlers/anthropic'

describe('when Anthropic is unavailable', () => {
  beforeEach(() => {
    // Override just for these tests
    server.use(anthropicErrorHandler)
  })

  it('shows an error message to the user', async () => {
    // ... test body
  })
})
```

The `server.use()` override is reset after each test by the `server.resetHandlers()` call in `tests/setup.ts`.

---

## Asserting Mock Was Called

To verify an external service was called with the right arguments (e.g., email was sent):

```typescript
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'

it('sends a confirmation email after signup', async () => {
  let capturedEmailBody: unknown = null

  server.use(
    http.post('https://api.resend.com/emails', async ({ request }) => {
      capturedEmailBody = await request.json()
      return HttpResponse.json({ id: 'mock-email-id' })
    })
  )

  // Trigger the signup flow
  // ...

  expect(capturedEmailBody).toMatchObject({
    subject: expect.stringContaining('Welcome'),
    to: expect.arrayContaining(['test@example.com']),
  })
})
```
