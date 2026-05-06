import { test, expect } from '../fixtures/tauri-mock'

test.describe('Navigation', () => {
  test('sidebar shows project with worktrees', async ({ mockPage }) => {
    // Wait for app to load
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    // Open sidebar panel if not visible
    const projectsHeader = mockPage.getByText('PROJECTS')
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Meta+b')
      await mockPage.waitForTimeout(500)
    }

    // Sidebar should show project and worktrees
    await expect(projectsHeader).toBeVisible({ timeout: 3000 })
    await expect(mockPage.getByText('fuzzy-tiger')).toBeVisible({
      timeout: 3000,
    })
    await expect(mockPage.getByText('calm-dolphin')).toBeVisible({
      timeout: 3000,
    })
  })

  test('click worktree navigates to chat view', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    // Open sidebar
    const projectsHeader = mockPage.getByText('PROJECTS')
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Meta+b')
      await mockPage.waitForTimeout(500)
    }

    // Click a worktree
    await mockPage.getByText('fuzzy-tiger').click()
    await mockPage.waitForTimeout(1000)

    await expect(
      mockPage.getByRole('heading', {
        name: /Test Project\s*›\s*fuzzy-tiger/,
      })
    ).toBeVisible({ timeout: 3000 })
  })

  test('right-click worktree can fork it', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    const projectsHeader = mockPage.getByText('PROJECTS')
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Meta+b')
      await mockPage.waitForTimeout(500)
    }

    await mockPage.getByText('fuzzy-tiger').click({ button: 'right' })
    await mockPage.getByRole('menuitem', { name: 'Fork Worktree' }).click()

    await expect(
      mockPage.getByRole('button', { name: 'fuzzy-tiger-fork' }).last()
    ).toBeVisible({ timeout: 3000 })
  })

  test('right-click fork uses a stable slot when enabled', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    const sourceWorktree = await mockPage.evaluate(() => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      return handlers
        .list_worktrees()
        .find((worktree: any) => worktree.name === 'fuzzy-tiger')
    })

    await mockPage.evaluate(projectId => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      handlers.update_project_settings({
        projectId,
        stableWorktreeSlotsEnabled: true,
      })
    }, sourceWorktree.project_id)

    const projectsHeader = mockPage.getByText('PROJECTS')
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Meta+b')
      await mockPage.waitForTimeout(500)
    }

    await mockPage.getByText('fuzzy-tiger').click({ button: 'right' })
    await mockPage.getByRole('menuitem', { name: 'Fork Worktree' }).click()

    await expect(
      mockPage.getByRole('button', { name: 'fuzzy-tiger-fork' }).last()
    ).toBeVisible({ timeout: 3000 })

    const { forkedWorktree, slots } = await mockPage.evaluate(projectId => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      const worktrees = handlers.list_worktrees()
      return {
        forkedWorktree: worktrees.find(
          (worktree: any) => worktree.name === 'fuzzy-tiger-fork'
        ),
        slots: handlers.list_worktree_slots({ projectId }),
      }
    }, sourceWorktree.project_id)

    expect(slots).toHaveLength(1)
    expect(slots[0].state).toBe('active')
    expect(slots[0].worktree_id).toBe(forkedWorktree.id)
    expect(forkedWorktree.stable_slot_id).toBe(slots[0].id)
    expect(forkedWorktree.path).toBe(slots[0].path)
    expect(forkedWorktree.path).toContain('/.jean-slots/')
    expect(forkedWorktree.base_branch).toBe(sourceWorktree.branch)
  })
})
