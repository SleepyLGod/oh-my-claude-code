import { afterEach, describe, expect, test } from 'bun:test'
import {
  getTotalCost,
  getUsageForModel,
  resetCostState,
} from 'src/cost-tracker.js'
import { getContextWindowForModel } from 'src/utils/context.js'
import {
  getResolvedLLMProfileByName,
  getSuggestedModelsForProfile,
} from './config.js'
import {
  getBlockingLLMProfileEnvOverride,
  getLLMProfileEnvOverrideMessage,
} from './selection.js'
import { AnthropicCompatibleClient } from './AnthropicCompatibleClient.js'
import { OpenAICompatibleClient } from './OpenAICompatibleClient.js'

const originalFetch = globalThis.fetch
const originalDeepseekApiKey = process.env.DEEPSEEK_API_KEY
const originalQwenApiKey = process.env.QWEN_API_KEY
const originalBailianCodingPlanApiKey = process.env.BAILIAN_CODING_PLAN_API_KEY
const originalQwenCodingApiKey = process.env.QWEN_CODING_API_KEY
const originalDashscopeCodingApiKey = process.env.DASHSCOPE_CODING_API_KEY
const originalDashscopeApiKey = process.env.DASHSCOPE_API_KEY
const originalNvidiaApiKey = process.env.NVIDIA_API_KEY
const originalNvidiaNimApiKey = process.env.NVIDIA_NIM_API_KEY
const originalClaudeCodeLLMProfile = process.env.CLAUDE_CODE_LLM_PROFILE

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

afterEach(() => {
  globalThis.fetch = originalFetch
  resetCostState()
  restoreEnv('DEEPSEEK_API_KEY', originalDeepseekApiKey)
  restoreEnv('QWEN_API_KEY', originalQwenApiKey)
  restoreEnv('BAILIAN_CODING_PLAN_API_KEY', originalBailianCodingPlanApiKey)
  restoreEnv('QWEN_CODING_API_KEY', originalQwenCodingApiKey)
  restoreEnv('DASHSCOPE_CODING_API_KEY', originalDashscopeCodingApiKey)
  restoreEnv('DASHSCOPE_API_KEY', originalDashscopeApiKey)
  restoreEnv('NVIDIA_API_KEY', originalNvidiaApiKey)
  restoreEnv('NVIDIA_NIM_API_KEY', originalNvidiaNimApiKey)
  restoreEnv('CLAUDE_CODE_LLM_PROFILE', originalClaudeCodeLLMProfile)
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

describe('OpenAICompatibleClient', () => {
  test('deepseek v4 models are shown as 1m and accounted as 1m', () => {
    expect(getResolvedLLMProfileByName('deepseek', {} as never).defaultModel).toBe(
      'deepseek-v4-pro[1m]',
    )
    expect(getSuggestedModelsForProfile('deepseek', {} as never)).toEqual([
      'deepseek-v4-flash[1m]',
      'deepseek-v4-pro[1m]',
      'deepseek-chat',
      'deepseek-reasoner',
    ])
    expect(getSuggestedModelsForProfile('deepseek-anthropic', {} as never)).toEqual([
      'deepseek-v4-flash[1m]',
      'deepseek-v4-pro[1m]',
      'deepseek-chat',
      'deepseek-reasoner',
    ])
    expect(getContextWindowForModel('deepseek-v4-pro[1m]')).toBe(1_000_000)
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
    expect(getContextWindowForModel('deepseek-v4-flash[1m]')).toBe(1_000_000)
    expect(getContextWindowForModel('deepseek-v4-flash')).toBe(1_000_000)
  })

  test('profile env override blocks selecting a different provider', () => {
    delete process.env.CLAUDE_CODE_LLM_PROFILE
    expect(getBlockingLLMProfileEnvOverride('qwen')).toBeNull()

    process.env.CLAUDE_CODE_LLM_PROFILE = 'qwen'
    expect(getBlockingLLMProfileEnvOverride('qwen')).toBeNull()

    process.env.CLAUDE_CODE_LLM_PROFILE = 'deepseek'
    expect(getBlockingLLMProfileEnvOverride('qwen')).toBe('deepseek')
    expect(getLLMProfileEnvOverrideMessage('qwen', 'deepseek')).toContain(
      'CLAUDE_CODE_LLM_PROFILE=deepseek',
    )
    expect(getLLMProfileEnvOverrideMessage('qwen', 'deepseek')).toContain(
      'CLAUDE_CODE_LLM_PROFILE=qwen',
    )
  })

  test('local profiles can call OpenAI-compatible APIs without an API key', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'llama3.1',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    await client.sideQuery({
      model: 'llama3.1',
      messages: [{ role: 'user', content: 'hello' }],
      querySource: 'test',
    })

    expect(calls).toHaveLength(1)
    expect(
      (calls[0]?.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined()
  })

  test('side-query payloads are stable for identical inputs', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    const bodies: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'llama3.1',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    const request = {
      model: 'llama3.1',
      system: [
        {
          type: 'text',
          text: 'Stable system prompt',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user' as const, content: 'same prompt' }],
      querySource: 'test' as const,
    }

    await client.sideQuery(request)
    await client.sideQuery(request)

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(bodies[0]).toContain('Stable system prompt')
    expect(bodies[0]).not.toContain('chatcmpl-test')
  })

  test('api key fallbacks are accepted for cloud profiles', async () => {
    delete process.env.QWEN_API_KEY
    process.env.DASHSCOPE_API_KEY = 'dashscope-test-key'
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'qwen-plus',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new OpenAICompatibleClient(
      'qwen',
      getResolvedLLMProfileByName('qwen'),
    )
    await client.sideQuery({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      querySource: 'test',
    })

    expect(
      (calls[0]?.headers as Record<string, string> | undefined)?.authorization,
    ).toBe('Bearer dashscope-test-key')
  })

  test('streaming chat completions emit text deltas and a final assistant message', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{"content":"hel"}}]}',
                  '',
                  'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
                  '',
                  'data: [DONE]',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    const messages = []
    for await (const message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: {},
      tools: [],
      signal: new AbortController().signal,
      options: {
        model: 'llama3.1',
        getToolPermissionContext: async () => ({}) as never,
        isNonInteractiveSession: true,
        querySource: 'test',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    } as never)) {
      messages.push(message)
    }

    expect(JSON.stringify(messages)).toContain('"type":"text_delta"')
    expect(JSON.stringify(messages)).toContain('hello')
  })

  test('streaming tool calls emit tool_use deltas before the final assistant message', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      const chunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: {
                      name: 'Read',
                      arguments: '{"file_path"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ':"README.md"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  ...chunks.flatMap(chunk => [
                    `data: ${JSON.stringify(chunk)}`,
                    '',
                  ]),
                  'data: [DONE]',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    const messages = []
    for await (const message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: {},
      tools: [],
      signal: new AbortController().signal,
      options: {
        model: 'llama3.1',
        getToolPermissionContext: async () => ({}) as never,
        isNonInteractiveSession: true,
        querySource: 'test',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    } as never)) {
      messages.push(message)
    }

    const serialized = JSON.stringify(messages)
    expect(serialized).toContain('"type":"tool_use"')
    expect(serialized).toContain('"type":"input_json_delta"')
    expect(serialized).toContain('"stop_reason":"tool_use"')
    expect(serialized).toContain('README.md')
  })

  test('stream usage options are profile-controlled', async () => {
    const bodies: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    for (const profileName of ['ollama', 'lmstudio']) {
      const client = new OpenAICompatibleClient(
        profileName,
        getResolvedLLMProfileByName(profileName),
      )
      for await (const _message of client.streamMainQuery({
        messages: [],
        systemPrompt: ['system'],
        thinkingConfig: {},
        tools: [],
        signal: new AbortController().signal,
        options: {
          model: 'local-model',
          getToolPermissionContext: async () => ({}) as never,
          isNonInteractiveSession: true,
          querySource: 'test',
          agents: [],
          hasAppendSystemPrompt: false,
          mcpTools: [],
        },
      } as never)) {
        // drain stream
      }
    }

    expect(bodies[0]).toContain('"stream_options":{"include_usage":true}')
    expect(bodies[1]).not.toContain('stream_options')
  })
})

describe('AnthropicCompatibleClient', () => {
  test('deepseek anthropic profile uses x-api-key auth and strips 1m suffix', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-test-key'
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({
          id: 'msg-test',
          model: 'deepseek-v4-pro',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new AnthropicCompatibleClient(
      'deepseek-anthropic',
      getResolvedLLMProfileByName('deepseek-anthropic'),
    )
    const response = await client.sideQuery({
      model: 'deepseek-v4-pro[1m]',
      messages: [{ role: 'user', content: 'hello' }],
      querySource: 'test',
    })

    const headers = calls[0]?.init.headers as Record<string, string>
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(calls[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(body.model).toBe('deepseek-v4-pro')
    expect(headers['x-api-key']).toBe('deepseek-test-key')
    expect(headers.authorization).toBeUndefined()
    expect(response.content[0]).toEqual({ type: 'text', text: 'ok' })
  })

  test('qwen anthropic profile uses normal dashscope key on Beijing endpoint', async () => {
    process.env.QWEN_API_KEY = 'qwen-test-key'
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({
          id: 'msg-test',
          model: 'qwen3.5-plus',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new AnthropicCompatibleClient(
      'qwen-anthropic',
      getResolvedLLMProfileByName('qwen-anthropic'),
    )
    await client.sideQuery({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      querySource: 'test',
    })

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(calls[0]?.url).toBe('https://dashscope.aliyuncs.com/apps/anthropic/v1/messages')
    expect(headers['x-api-key']).toBe('qwen-test-key')
  })

  test('qwen coding anthropic profile uses bearer auth', async () => {
    process.env.BAILIAN_CODING_PLAN_API_KEY = 'bailian-coding-test-key'
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return new Response(
        JSON.stringify({
          id: 'msg-test',
          model: 'qwen3.5-plus',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new AnthropicCompatibleClient(
      'qwen-coding-anthropic',
      getResolvedLLMProfileByName('qwen-coding-anthropic'),
    )
    await client.sideQuery({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      querySource: 'test',
    })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer bailian-coding-test-key')
    expect(headers['x-api-key']).toBeUndefined()
  })

  test('streaming messages preserve tool_use deltas and subscription usage', async () => {
    resetCostState()
    process.env.BAILIAN_CODING_PLAN_API_KEY = 'bailian-coding-test-key'
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg-test',
            model: 'qwen3.5-plus',
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Read',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"file_path":"README.md"}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 3 },
        },
        { type: 'message_stop' },
      ]
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                events
                  .flatMap(event => [`data: ${JSON.stringify(event)}`, ''])
                  .join('\n'),
              ),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = new AnthropicCompatibleClient(
      'qwen-coding-anthropic',
      getResolvedLLMProfileByName('qwen-coding-anthropic'),
    )
    const messages = []
    for await (const message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: {},
      tools: [],
      signal: new AbortController().signal,
      options: {
        model: 'qwen3.5-plus',
        getToolPermissionContext: async () => ({}) as never,
        isNonInteractiveSession: true,
        querySource: 'test',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    } as never)) {
      messages.push(message)
    }

    const serialized = JSON.stringify(messages)
    expect(serialized).toContain('"type":"tool_use"')
    expect(serialized).toContain('README.md')
    expect(getTotalCost()).toBe(0)
    expect(getUsageForModel('qwen3.5-plus')?.inputTokens).toBe(5)
    expect(getUsageForModel('qwen3.5-plus')?.outputTokens).toBe(3)
  })
})
