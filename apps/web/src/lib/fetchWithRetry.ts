type FetchWithRetryOptions = RequestInit & {
  timeout?: number
  retries?: number
  retryDelay?: number
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeout = 10000, retries = 2, retryDelay = 500, ...init } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (!response.ok && attempt < retries && response.status >= 500) {
        await delay(retryDelay * Math.pow(2, attempt))
        continue
      }
      return response
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt === retries) break
      await delay(retryDelay * Math.pow(2, attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}
