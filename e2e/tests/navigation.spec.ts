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
})
