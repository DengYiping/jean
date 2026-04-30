import { describe, expect, it } from 'vitest'
import { canMoveAgentBoardItem } from '@/types/agent-board'

describe('canMoveAgentBoardItem', () => {
  it('allows PR opened cards to archive', () => {
    expect(canMoveAgentBoardItem('pr_opened', 'archived')).toBe(true)
  })

  it('blocks PR opened cards from moving to active lanes', () => {
    expect(canMoveAgentBoardItem('pr_opened', 'implemented')).toBe(false)
    expect(canMoveAgentBoardItem('pr_opened', 'implementing')).toBe(false)
  })

  it('returns terminal cards to active lanes on resumed work', () => {
    expect(canMoveAgentBoardItem('implemented', 'implementing')).toBe(true)
    expect(canMoveAgentBoardItem('yoloed', 'yoloing')).toBe(true)
  })
})
