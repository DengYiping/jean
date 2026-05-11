import { test, expect } from '../fixtures/tauri-mock'
import { createProject, createWorktree } from '../fixtures/mock-data'
import { project } from '../fixtures/invoke-handlers'

const soloProject = createProject({
  name: 'Solo Project',
  path: '/tmp/solo-project',
})
const soloWorktree = createWorktree(soloProject.id, {
  name: 'solo-worktree',
  branch: 'solo-worktree',
  path: '/tmp/solo-project/.worktrees/solo-worktree',
})

const manyProject = createProject({
  name: 'Many Project',
  path: '/tmp/many-project',
})
const alphaWorktree = createWorktree(manyProject.id, {
  name: 'alpha-worktree',
  branch: 'alpha-branch',
  path: '/tmp/many-project/.worktrees/alpha-worktree',
  order: 0,
})
const betaWorktree = createWorktree(manyProject.id, {
  name: 'beta-worktree',
  branch: 'beta-branch',
  path: '/tmp/many-project/.worktrees/beta-worktree',
  order: 1,
})

test.describe('Keyboard shortcuts', () => {
  test('Cmd+K opens command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Meta+k')

    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
  })

  test('Cmd+B toggles sidebar panel', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    const projectsHeader = mockPage.getByText('PROJECTS')
    const initialSidebarVisible = await projectsHeader
      .isVisible()
      .catch(() => false)

    await mockPage.keyboard.press('Meta+b')
    await expect
      .poll(async () => projectsHeader.isVisible().catch(() => false), {
        timeout: 3000,
      })
      .toBe(!initialSidebarVisible)

    await mockPage.keyboard.press('Meta+b')
    await expect
      .poll(async () => projectsHeader.isVisible().catch(() => false), {
        timeout: 3000,
      })
      .toBe(initialSidebarVisible)
  })

  test('Escape closes command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Meta+k')
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })

    await mockPage.keyboard.press('Escape')
    await expect(input).not.toBeVisible({ timeout: 2000 })
  })

  test.use({
    responseOverrides: {
      create_worktree: createWorktree(project.id, {
        name: 'new-worktree',
        branch: 'new-worktree',
        order: 2,
      }),
    },
  })

  test('Cmd+N opens quick actions and N creates a worktree', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Meta+n')

    await expect(mockPage.getByText('New Worktree')).toBeVisible({
      timeout: 3000,
    })

    await mockPage.keyboard.press('n')

    await expect(
      mockPage.getByRole('dialog', { name: /New Session for Test Project/i })
    ).not.toBeVisible({ timeout: 3000 })
  })

  test('Cmd+K opens a worktree in the current project directly', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Meta+k')
    await mockPage.locator('[cmdk-input]').fill('calm-dolphin')
    await mockPage.keyboard.press('Enter')

    await expect(
      mockPage.getByRole('heading', {
        name: /Test Project\s*›\s*calm-dolphin/,
      })
    ).toBeVisible({
      timeout: 3000,
    })
  })

  test.describe('Cmd+K project worktree navigation', () => {
    test.use({
      responseOverrides: {
        list_projects: [project, soloProject],
        list_worktrees: [soloWorktree],
      },
    })

    test('opens the only worktree for a selected project result', async ({
      mockPage,
    }) => {
      await expect(mockPage.getByText('Test Project')).toBeVisible({
        timeout: 5000,
      })

      await mockPage.keyboard.press('Meta+k')
      await mockPage.locator('[cmdk-input]').fill('Solo Project')
      await mockPage.keyboard.press('Enter')

      await expect(
        mockPage.getByRole('heading', {
          name: /Solo Project\s*›\s*solo-worktree/,
        })
      ).toBeVisible({
        timeout: 3000,
      })
    })
  })

  test.describe('Cmd+K multi-worktree project navigation', () => {
    test.use({
      responseOverrides: {
        list_projects: [project, manyProject],
        list_worktrees: [alphaWorktree, betaWorktree],
      },
    })

    test('drills into worktrees for a multi-worktree project', async ({
      mockPage,
    }) => {
      await expect(mockPage.getByText('Test Project')).toBeVisible({
        timeout: 5000,
      })

      await mockPage.keyboard.press('Meta+k')
      await mockPage.locator('[cmdk-input]').fill('Many Project')
      await mockPage.keyboard.press('Enter')

      await expect(mockPage.locator('[cmdk-input]')).toHaveAttribute(
        'placeholder',
        /Search worktrees in Many Project/
      )

      await mockPage.locator('[cmdk-input]').fill('beta')
      await mockPage.keyboard.press('Enter')

      await expect(
        mockPage.getByRole('heading', {
          name: /Many Project\s*›\s*beta-worktree/,
        })
      ).toBeVisible({
        timeout: 3000,
      })
    })
  })

  test.describe('Cmd+K session filtering', () => {
    test('does not show sessions as navigation results', async ({
      mockPage,
    }) => {
      await expect(mockPage.getByText('Test Project')).toBeVisible({
        timeout: 5000,
      })

      await mockPage.keyboard.press('Meta+k')
      await mockPage.locator('[cmdk-input]').fill('Secret Session')

      await expect(mockPage.getByText('No results found.')).toBeVisible({
        timeout: 3000,
      })
    })
  })
})
