export function splitDiffFileLines(contents: string): string[] {
  return contents.match(/[^\n]*\n|[^\n]+$/g) ?? []
}
