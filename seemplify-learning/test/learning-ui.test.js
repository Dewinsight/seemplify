import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ejs from 'ejs'
import { learningUiFixture, sampleCourse } from './fixtures/learning-ui.js'

const views = fileURLToPath(new URL('../src/views/', import.meta.url))
const render = (name, data) => ejs.renderFile(path.join(views, `${name}.ejs`), learningUiFixture(data))

test('every Learning page and shared component compiles', async () => {
  for (const directory of [views, path.join(views, 'partials')]) {
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.ejs')) continue
      const filename = path.join(directory, name)
      ejs.compile(await readFile(filename, 'utf8'), { filename })
    }
  }
})

test('admin renders all sections with empty data and keeps form action routes', async () => {
  for (const adminSection of ['overview','courses','approvals','partners','super-users','audit-log','creators','users','commission','payments','settings','analytics']) {
    const html = await render('admin-dashboard', { adminSection })
    assert.match(html, /id="main-content"/)
    assert.match(html, /aria-current="page"/)
    assert.match(html, /href="\/admin\/courses\/new"/)
    assert.match(html, /data-ui-menu aria-controls="admin-navigation" aria-expanded="false"/)
  }
})

test('pending review renders escaped creator content and the course review route', async () => {
  const html = await render('admin-dashboard', {
    approvalQueueCourses: [{ ...sampleCourse, title: '<script>bad()</script>' }],
    adminCourses: [sampleCourse],
  })
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/)
  assert.match(html, /href="\/admin\/courses\/507f1f77bcf86cd799439011\?returnTo=%2Fadmin%2Fapprovals"/)
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/)
})

test('public home and catalogue support empty and populated states', async () => {
  for (const courses of [[], [sampleCourse]]) {
    const home = await render('public-home', { user: null, activePage: 'home', featuredCourses: courses })
    assert.match(home, /action="\/courses" method="get"/)
    assert.match(home, /for="home-course-search"/)
    const catalogue = await render('public-courses', { user: null, activePage: 'courses', courses, levels: [{ value: 'beginner', label: 'Beginner' }] })
    assert.match(catalogue, /name="q"/)
    assert.match(catalogue, /name="category"/)
    if (courses.length) assert.match(catalogue, /Practical project management/)
    else assert.match(catalogue, /No courses found/)
  }
})

test('learner workspace, studio, public details and partner tools render with shared navigation', async () => {
  for (const name of ['simple-lms', 'simple-lms-settings', 'course-studio', 'public-course-detail', 'teach-landing', 'partner-dashboard', 'agent-dashboard', 'simple-lms-player']) {
    const html = await render(name, { enrollment: { _id: '507f1f77bcf86cd799439013' } })
    assert.match(html, /id="main-content"/)
    assert.match(html, /class="ui-header"/)
  }
})

test('navigation preserves privileged destinations and omits them for learners', async () => {
  const admin = await render('public-home')
  assert.match(admin, /href="\/admin"/)
  const learner = await render('public-home', { user: { email: 'learner@example.test', profile: { name: 'Learner' }, learningRole: 'learner' }, accessProfile: {} })
  assert.doesNotMatch(learner, /href="\/admin"/)
  assert.match(learner, /href="\/simple-lms\?view=settings"/)
})
