import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { Markdown } from './markdown'

describe('Markdown math rendering', () => {
  it('renders inline LaTeX math', () => {
    const { container } = render(<Markdown>Inline $C_L$ math</Markdown>)

    expect(container.querySelector('.katex')).toBeInTheDocument()
    expect(screen.getByText(/Inline/)).toBeInTheDocument()
  })

  it('renders display LaTeX math', () => {
    const { container } = render(
      <Markdown>{'$$\n\\theta_{t+1} = \\theta_t - \\alpha g_t\n$$'}</Markdown>
    )

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
  })

  it('renders standalone square-bracket formula lines from model output', () => {
    const { container } = render(
      <Markdown>{'[ \\theta_{t+1} = \\theta_t - \\alpha g_t ]'}</Markdown>
    )

    expect(container.querySelector('.katex-display')).toBeInTheDocument()
  })

  it('leaves ordinary brackets and task lists as normal markdown', () => {
    const { container } = render(
      <Markdown>
        {'This is [ordinary bracket text].\n\n- [ ] Keep this task unchecked'}
      </Markdown>
    )

    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(
      screen.getByText(/This is \[ordinary bracket text\]\./)
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.getByText(/Keep this task unchecked/)).toBeInTheDocument()
  })

  it('converts app-data image paths into loadable file URLs', () => {
    const { container } = render(
      <Markdown>
        {
          '![Linear screenshot](</Users/me/Library/Application Support/com.jean.desktop/linear-context-images/ENG-123/image.png>)'
        }
      </Markdown>
    )

    const image = container.querySelector('img')

    expect(image?.getAttribute('src')).toBe(
      '/api/files/linear-context-images/ENG-123/image.png'
    )
  })
})
