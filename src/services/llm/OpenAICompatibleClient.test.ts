import { afterEach, describe, expect, test } from 'bun:test'
import {
  getTotalCost,
  getUsageForModel,
  resetCostState,
} from 'src/cost-tracker.js'
import { getContextWindowForModel } from 'src/utils/context.js'
import {
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import {
  getResolvedLLMProfileByName,
  getSuggestedModelsForProfile,
} from './config.js'
import { clearModelDiscoveryCache, mergeModelSuggestions } from './modelDiscovery.js'
import {
  getBlockingLLMProfileEnvOverride,
  getLLMProfileEnvOverrideMessage,
} from './selection.js'
import { AnthropicCompatibleClient } from './AnthropicCompatibleClient.js'
import { OpenAICompatibleClient } from './OpenAICompatibleClient.js'
import type { LLMSideQueryRequest } from './types.js'

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
  clearModelDiscoveryCache()
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

  test('local no-thinking model marker is stripped before provider API calls', () => {
    expect(normalizeModelStringForAPI('deepseek-v4-pro[1m][no-thinking]')).toBe(
      'deepseek-v4-pro',
    )
    expect(parseUserSpecifiedModel('deepseek-v4-pro[1m][no-thinking]')).toBe(
      'deepseek-v4-pro[1m][no-thinking]',
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
    }) as unknown as typeof fetch

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
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    const request: LLMSideQueryRequest = {
      model: 'llama3.1',
      system: [
        {
          type: 'text' as const,
          text: 'Stable system prompt',
          cache_control: { type: 'ephemeral' as const },
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
    }) as unknown as typeof fetch

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

  test('OpenAI-compatible model discovery reads /models', async () => {
    const urls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(
        JSON.stringify({
          data: [
            { id: 'llama3.1' },
            { id: 'qwen2.5-coder' },
            { id: '' },
          ],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient(
      'ollama',
      getResolvedLLMProfileByName('ollama'),
    )

    await expect(client.listModels()).resolves.toEqual([
      { id: 'llama3.1' },
      { id: 'qwen2.5-coder' },
    ])
    expect(urls).toEqual(['http://127.0.0.1:11434/v1/models'])
  })

  test('OpenAI-compatible main requests use explicit max tokens', async () => {
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
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', {
      ...getResolvedLLMProfileByName('ollama'),
      streaming: 'disabled',
    })
    for await (const _message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: { type: 'disabled' },
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
      // drain
    }

    expect(JSON.parse(bodies[0] ?? '{}').max_tokens).toBe(32_000)
  })

  test('OpenAI-compatible length finish reason emits max-token recovery message', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'llama3.1',
          choices: [
            { message: { content: 'partial' }, finish_reason: 'length' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 32_000 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', {
      ...getResolvedLLMProfileByName('ollama'),
      streaming: 'disabled',
    })
    const messages = []
    for await (const message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: { type: 'disabled' },
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

    expect(JSON.stringify(messages)).toContain('"apiError":"max_output_tokens"')
  })

  test('model suggestions merge static and discovered models', () => {
    expect(
      mergeModelSuggestions('ollama', [
        { id: 'llama3.1' },
        { id: 'custom-local-model' },
      ]).map(model => model.id),
    ).toEqual(['llama3.1', 'qwen2.5-coder', 'mistral', 'custom-local-model'])

    expect(
      mergeModelSuggestions('deepseek-anthropic', [
        { id: 'deepseek-extra' },
      ]).map(model => model.id),
    ).toContain('deepseek-v4-pro[1m][no-thinking]')
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
    }) as unknown as typeof fetch

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
    }) as unknown as typeof fetch

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

  test('streaming text think tags are emitted as thinking blocks', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{"content":"<thi"}}]}',
                  '',
                  'data: {"choices":[{"delta":{"content":"nk>private"}}]}',
                  '',
                  'data: {"choices":[{"delta":{"content":" thought</think>visible"},"finish_reason":"stop"}]}',
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
    }) as unknown as typeof fetch

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
    expect(serialized).toContain('"type":"thinking"')
    expect(serialized).toContain('private thought')
    expect(serialized).toContain('visible')
    expect(serialized).not.toContain('<think>')
  })

  test('unclosed streaming think tags stay visible instead of swallowing output', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{"content":"<think>still visible"},"finish_reason":"stop"}]}',
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
    }) as unknown as typeof fetch

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
    expect(serialized).toContain('<think>still visible')
    expect(serialized).not.toContain('"type":"thinking"')
  })

  test('text-emitted tool calls are parsed only for offered tools', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'llama3.1',
          choices: [
            {
              message: {
                content:
                  'I will read it. <function=Read><parameter=file_path>README.md</parameter></function>',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', {
      ...profile,
      streaming: 'disabled',
    })
    const response = await client.sideQuery({
      model: 'llama3.1',
      messages: [],
      tools: [{ name: 'Read', input_schema: { type: 'object' } }],
      querySource: 'test',
    })

    const serialized = JSON.stringify(response)
    expect(serialized).toContain('"type":"tool_use"')
    expect(serialized).toContain('"name":"Read"')
    expect(serialized).toContain('README.md')
    expect(serialized).not.toContain('<function=Read>')
  })

  test('text-emitted tool calls stay text when no matching tool was offered', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          model: 'llama3.1',
          choices: [
            {
              message: {
                content:
                  '<function=Read><parameter=file_path>README.md</parameter></function>',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    const response = await client.sideQuery({
      model: 'llama3.1',
      messages: [],
      querySource: 'test',
    })

    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('"type":"tool_use"')
    expect(serialized).toContain('<function=Read>')
  })

  test('malformed streaming events fall back to non-streaming before tool use', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 2) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            model: 'llama3.1',
            choices: [
              { message: { content: 'fallback answer' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        )
      }
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{"content":"hello"}}]}',
                  '',
                  'data: {"choices":',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

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

    expect(calls).toBe(2)
    expect(JSON.stringify(messages)).toContain('fallback answer')
    expect(JSON.stringify(messages)).toContain('"type":"content_block_stop"')
  })

  test('malformed streaming events after tool use do not fallback', async () => {
    const profile = getResolvedLLMProfileByName('ollama')
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool_1","function":{"name":"Read","arguments":"{}"}}]}}]}',
                  '',
                  'data: {"choices":',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient('ollama', profile)
    let error: unknown
    try {
      for await (const _message of client.streamMainQuery({
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
        // drain
      }
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
  })

  test('stream usage options are profile-controlled', async () => {
    const bodies: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
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
    }) as unknown as typeof fetch

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
  test('anthropic-compatible main requests use explicit max tokens without default thinking', async () => {
    process.env.QWEN_API_KEY = 'qwen-test-key'
    const bodies: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
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
    }) as unknown as typeof fetch

    const client = new AnthropicCompatibleClient('qwen-anthropic', {
      ...getResolvedLLMProfileByName('qwen-anthropic'),
      streaming: 'disabled',
    })
    for await (const _message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: { type: 'adaptive' },
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
      // drain
    }

    const body = JSON.parse(bodies[0] ?? '{}')
    expect(body.max_tokens).toBe(32_000)
    expect(body.thinking).toBeUndefined()
  })

  test('anthropic-compatible explicit thinking sends budget payload', async () => {
    process.env.QWEN_API_KEY = 'qwen-test-key'
    const bodies: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
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
    }) as unknown as typeof fetch

    const client = new AnthropicCompatibleClient('qwen-anthropic', {
      ...getResolvedLLMProfileByName('qwen-anthropic'),
      streaming: 'disabled',
    })
    for await (const _message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: { type: 'enabled', budgetTokens: 1024 },
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
      // drain
    }

    expect(JSON.parse(bodies[0] ?? '{}').thinking).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    })
  })

  test('anthropic-compatible max_tokens stop emits recovery message', async () => {
    process.env.QWEN_API_KEY = 'qwen-test-key'
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: 'msg-test',
          model: 'qwen3.5-plus',
          content: [{ type: 'text', text: 'partial' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 1, output_tokens: 32_000 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new AnthropicCompatibleClient('qwen-anthropic', {
      ...getResolvedLLMProfileByName('qwen-anthropic'),
      streaming: 'disabled',
    })
    const messages = []
    for await (const message of client.streamMainQuery({
      messages: [],
      systemPrompt: ['system'],
      thinkingConfig: { type: 'adaptive' },
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

    expect(JSON.stringify(messages)).toContain('"apiError":"max_output_tokens"')
  })

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
    }) as unknown as typeof fetch

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
    }) as unknown as typeof fetch

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

  test('anthropic-compatible model discovery reads /v1/models when enabled', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-test-key'
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'deepseek-v4-pro',
              display_name: 'DeepSeek V4 Pro',
            },
          ],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const client = new AnthropicCompatibleClient('deepseek-anthropic', {
      ...getResolvedLLMProfileByName('deepseek-anthropic'),
      supportsModelList: true,
    })

    await expect(client.listModels()).resolves.toEqual([
      { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
    ])
    expect(calls[0]?.url).toBe(
      'https://api.deepseek.com/anthropic/v1/models',
    )
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
    }) as unknown as typeof fetch

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
    }) as unknown as typeof fetch

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
