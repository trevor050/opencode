const TOKEN_EDGE_PUNCTUATION = /^[`"'([{]+|[`"',.;:)\]}]+$/g

function stripShellComments(text: string | undefined) {
  return (text ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n")
}

export function hasShellControlOperator(text: string | undefined) {
  return /&&|\|\||[;|<>`]|[$][(]/.test(stripShellComments(text))
}

export function commandTextTokens(text: string | undefined) {
  return stripShellComments(text)
    .split(/\s+/)
    .map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, ""))
    .filter(Boolean)
}

export function hasExactCommandFlag(text: string | undefined, flag: string) {
  return commandTextTokens(text).includes(flag)
}

export function hasExactCommandToken(text: string | undefined, token: string | undefined) {
  return !!token && commandTextTokens(text).includes(token)
}

export function hasExactCommandPrefix(text: string | undefined, expectedTokens: string[]) {
  const tokens = commandTextTokens(text)
  return expectedTokens.every((token, index) => tokens[index] === token)
}

export function hasExactCommandTokens(text: string | undefined, expectedTokens: string[]) {
  const tokens = commandTextTokens(text)
  return tokens.length === expectedTokens.length && expectedTokens.every((token, index) => tokens[index] === token)
}

export function hasExactCommandTokenAfterPrefix(text: string | undefined, expectedPrefix: string[], token: string | undefined) {
  if (!token) return false
  const tokens = commandTextTokens(text)
  return expectedPrefix.every((prefixToken, index) => tokens[index] === prefixToken) && tokens[expectedPrefix.length] === token
}

export function hasExactCommandArg(text: string | undefined, flag: string, value: string | undefined) {
  if (!value) return false
  const tokens = commandTextTokens(text)
  return tokens.some((token, index) => token === flag && tokens[index + 1] === value)
}

export function commandArgValues(text: string | undefined, flag: string) {
  const tokens = commandTextTokens(text)
  return tokens.flatMap((token, index) => (token === flag && tokens[index + 1] ? [tokens[index + 1]!] : []))
}

export function hasExactCommandArgValues(text: string | undefined, flag: string, values: string[]) {
  const actual = new Set(commandArgValues(text, flag))
  return values.every((value) => actual.has(value))
}

export function hasOnlyExactCommandArgValues(text: string | undefined, flag: string, values: string[]) {
  const actual = commandArgValues(text, flag)
  if (actual.length !== values.length) return false
  const expected = new Map<string, number>()
  for (const value of values) expected.set(value, (expected.get(value) ?? 0) + 1)
  for (const value of actual) {
    const count = expected.get(value) ?? 0
    if (count === 0) return false
    if (count === 1) expected.delete(value)
    else expected.set(value, count - 1)
  }
  return expected.size === 0
}

export function commandKeyValueValues(text: string | undefined, key: string) {
  return commandTextTokens(text).flatMap((token) => (token.startsWith(`${key}=`) ? [token.slice(key.length + 1)] : []))
}

export function hasExactCommandKeyValue(text: string | undefined, key: string, value: string | undefined) {
  if (!value) return false
  return commandTextTokens(text).includes(`${key}=${value}`)
}

export function hasOnlyExactCommandKeyValue(text: string | undefined, key: string, value: string | undefined) {
  if (!value) return false
  const values = commandKeyValueValues(text, key)
  return values.length === 1 && values[0] === value
}
