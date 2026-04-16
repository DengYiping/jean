import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { MemoizedFileView } from './MemoizedFileView'

const mockFile = vi.fn()

vi.mock('@pierre/diffs/react', () => ({
  File: (props: unknown) => {
    mockFile(props)
    return <div data-testid="pierre-file" />
  },
}))

describe('MemoizedFileView', () => {
  it('passes touched line highlighting CSS to the file renderer', () => {
    render(
      <MemoizedFileView
        fileContents={{
          name: 'src/example.ts',
          contents: 'one\ntwo\nthree\nfour',
        }}
        fileName="src/example.ts"
        themeType="light"
        syntaxThemeDark="vitesse-black"
        syntaxThemeLight="github-light"
        touchedLines={[4, 2, 2]}
      />
    )

    expect(screen.getByText('2 touched')).toBeInTheDocument()

    expect(mockFile).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          unsafeCSS: expect.stringContaining('[data-line="2"]'),
        }),
      })
    )

    expect(mockFile).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          unsafeCSS: expect.stringContaining('[data-line="4"]'),
        }),
      })
    )
  })
})
