import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createStructuredCompletion,
  createTextCompletion,
  resolveAiProtocol
} from '../src/llmClient.js'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function sseResponse(events) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${events.join('\n\n')}\n\n`))
      controller.close()
    }
  })

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream'
    }
  })
}

function installFetchMock(t, handler) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

test('protocol detection prefers endpoint and known gateway hints', () => {
  assert.equal(resolveAiProtocol({
    aiConfig: { baseURL: 'https://api.anthropic.com/v1' },
    model: 'claude-sonnet-4-5'
  }), 'anthropic')

  assert.equal(resolveAiProtocol({
    aiConfig: { baseURL: 'https://proxy.example.com/v1/messages' },
    model: 'custom-model'
  }), 'anthropic')

  assert.equal(resolveAiProtocol({
    aiConfig: { baseURL: 'https://api.siliconflow.cn/v1' },
    model: 'anthropic/claude-sonnet'
  }), 'openai')

  assert.equal(resolveAiProtocol({
    aiConfig: { baseURL: 'https://proxy.example.com/v1', apiProtocol: 'openai' },
    model: 'claude-sonnet'
  }), 'openai')
})

test('OpenAI-compatible requests keep the existing request and response format', async (t) => {
  let capturedRequest = null
  installFetchMock(t, async (url, options) => {
    capturedRequest = { url, options }
    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'OpenAI reply' } }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 3,
        total_tokens: 8
      }
    })
  })

  const result = await createTextCompletion({
    aiConfig: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'openai-test-key'
    },
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Hello' }],
    requestTimeoutMs: 1000
  })

  assert.equal(capturedRequest.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(capturedRequest.options.headers.Authorization, 'Bearer openai-test-key')
  assert.equal(capturedRequest.options.headers['x-api-key'], undefined)
  assert.deepEqual(JSON.parse(capturedRequest.options.body).messages, [
    { role: 'user', content: 'Hello' }
  ])
  assert.equal(result.text, 'OpenAI reply')
  assert.deepEqual(result.usage, {
    inputTokens: 5,
    outputTokens: 3,
    totalTokens: 8
  })
})

test('Anthropic requests convert system messages, headers, response text, and usage', async (t) => {
  let capturedRequest = null
  installFetchMock(t, async (url, options) => {
    capturedRequest = { url, options }
    return jsonResponse({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '{"action":"final","reply":"Done"}' }],
      usage: {
        input_tokens: 11,
        output_tokens: 7
      }
    })
  })

  const result = await createStructuredCompletion({
    aiConfig: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-test-key'
    },
    model: 'claude-test',
    messages: [
      { role: 'system', content: 'Follow the instructions.' },
      { role: 'user', content: 'Complete the task.' }
    ],
    requestTimeoutMs: 1000
  })

  const requestBody = JSON.parse(capturedRequest.options.body)

  assert.equal(capturedRequest.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(capturedRequest.options.headers['x-api-key'], 'anthropic-test-key')
  assert.equal(capturedRequest.options.headers['anthropic-version'], '2023-06-01')
  assert.equal(capturedRequest.options.headers.Authorization, undefined)
  assert.equal(requestBody.system, 'Follow the instructions.')
  assert.deepEqual(requestBody.messages, [
    { role: 'user', content: 'Complete the task.' }
  ])
  assert.equal(requestBody.max_tokens, 8192)
  assert.equal(requestBody.response_format, undefined)
  assert.equal(result.json.action, 'final')
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18
  })
})

test('Anthropic streaming events are normalized to text chunks and total usage', async (t) => {
  const chunks = []
  installFetchMock(t, async () => sseResponse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}',
    'event: message_stop\ndata: {"type":"message_stop"}'
  ]))

  const result = await createTextCompletion({
    aiConfig: {
      baseURL: 'https://api.anthropic.com/v1/messages',
      apiKey: 'anthropic-test-key'
    },
    model: 'claude-test',
    messages: [{ role: 'user', content: 'Hello' }],
    requestTimeoutMs: 1000,
    streamResponses: true,
    onTextChunk(delta, fullText) {
      chunks.push({ delta, fullText })
    }
  })

  assert.equal(result.text, 'Hello Claude')
  assert.deepEqual(chunks, [
    { delta: 'Hello ', fullText: 'Hello ' },
    { delta: 'Claude', fullText: 'Hello Claude' }
  ])
  assert.deepEqual(result.usage, {
    inputTokens: 9,
    outputTokens: 4,
    totalTokens: 13
  })
})
