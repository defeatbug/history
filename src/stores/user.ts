import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserProgress, Badge } from '../data/mockData'
import { mockBadges } from '../data/mockData'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'
import { fetchBadges } from '../services/content'
import {
  loadProgress,
  saveProgress,
  saveResumePoint,
  requestBadgeEvaluation,
  emptyProgress,
  canPersist,
} from '../services/progress'
import { recordAnswerWithSm2 } from '../services/review'

export const useUserStore = defineStore('user', () => {
  // -------------------------------------------------------------------------
  // 用户身份
  // -------------------------------------------------------------------------
  const userId = ref<string>('user-001')
  const username = ref<string>('历史学习者')
  const isLoggedIn = ref<boolean>(false)
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  const loading = ref<boolean>(false)
  /** 认证状态是否已完成初始化（路由守卫需要等它） */
  const initialized = ref<boolean>(false)
  /** 当前用户角色（student / admin），来自 profiles.role */
  const role = ref<'student' | 'admin'>('student')

  // -------------------------------------------------------------------------
  // 学习进度
  // -------------------------------------------------------------------------
  const progress = ref<UserProgress>(emptyProgress('user-001'))

  /** 全部勋章定义（优先取自数据库，失败时回退本地） */
  const badges = ref<Badge[]>(mockBadges)

  /** 已解锁勋章 */
  const unlockedBadges = computed(() =>
    badges.value.filter((badge) => progress.value.badges.includes(badge.id)),
  )

  /** 断点续学目标：有未完成的课程时才返回 */
  const resumeTarget = computed(() => {
    const lessonId = progress.value.lastLessonId
    if (!lessonId) return null
    if (progress.value.completedLessons.includes(lessonId)) return null
    return { lessonId, position: progress.value.lastPosition ?? 0 }
  })

  /** 是否管理员（仅用于界面显隐；真正的权限边界在数据库 RLS） */
  const isAdmin = computed(() => role.value === 'admin')

  /** 当前是否处于可持久化状态（非游客且已配置 Supabase） */
  const canSync = computed(() => canPersist(userId.value))

  // -------------------------------------------------------------------------
  // 数据同步
  // -------------------------------------------------------------------------

  /** 把本地进度写入数据库（静默失败，不阻塞交互） */
  const persist = async () => {
    if (!canSync.value) return
    await saveProgress(userId.value, progress.value)
  }

  /**
   * 读取角色。
   *
   * 角色是网络请求拉取的，而本项目的网络环境（代理）不稳定。
   * 若一次抖动就把管理员锁在后台外面，体验很差。
   * 因此：成功时写本地缓存；失败时回退到缓存值，并重试两次。
   *
   * 注意：这只是界面层的显隐与友善拦截，真正的权限边界在数据库 RLS。
   * 即使缓存被篗改，非管理员也读不到任何数据。
   */
  const ROLE_CACHE_KEY = 'hq:role'

  const loadRole = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId.value)
          .maybeSingle()

        if (error) throw error

        const next = data?.role === 'admin' ? 'admin' : 'student'
        role.value = next
        try {
          localStorage.setItem(ROLE_CACHE_KEY, next)
        } catch {
          // 隐私模式，忽略
        }
        return
      } catch (error) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 400 * attempt))
          continue
        }
        // 三次都失败：回退到缓存，避免网络抖动导致管理员被锁在外面
        try {
          const cached = localStorage.getItem(ROLE_CACHE_KEY)
          if (cached === 'admin' || cached === 'student') {
            role.value = cached
            console.warn('[user] 角色读取失败，改用本地缓存：', cached)
            return
          }
        } catch {
          // 忽略
        }
        console.warn('[user] 角色读取失败且无缓存：', error)
        role.value = 'student'
        return
      }
    }
  }

  /** 从数据库拉取进度与勋章，覆盖本地状态 */
  const loadFromDatabase = async () => {
    if (!canSync.value) return

    await loadRole()

    const loaded = await loadProgress(userId.value)
    if (!loaded) return

    progress.value = loaded.progress

    // 勋章定义也顺带刷新一次（失败会自动回退本地 mock）
    const badgeResult = await fetchBadges()
    badges.value = badgeResult.data
  }

  /**
   * 调用服务端勋章判定，合并新解锁的勋章。
   * 服务端是权威来源；本地 checkBadgeUnlock 仅用于即时反馈。
   */
  const syncBadges = async () => {
    if (!canSync.value) return

    const newlyUnlocked = await requestBadgeEvaluation(userId.value)
    for (const id of newlyUnlocked) {
      if (!progress.value.badges.includes(id)) {
        progress.value.badges.push(id)
      }
    }
  }

  // -------------------------------------------------------------------------
  // 本地勋章判定（乐观更新，用于即时 UI 反馈）
  // -------------------------------------------------------------------------
  const checkBadgeUnlock = () => {
    const { completedLessons, totalStudyTime, correctRate } = progress.value

    if (completedLessons.length >= 1 && !progress.value.badges.includes('badge-1')) {
      progress.value.badges.push('badge-1')
    }
    if (correctRate === 1 && !progress.value.badges.includes('badge-3')) {
      progress.value.badges.push('badge-3')
    }
    if (totalStudyTime >= 600 && !progress.value.badges.includes('badge-6')) {
      progress.value.badges.push('badge-6')
    }
    if (completedLessons.length >= 14 && !progress.value.badges.includes('badge-5')) {
      progress.value.badges.push('badge-5')
    }
  }

  // -------------------------------------------------------------------------
  // 进度更新（本地即时生效 + 异步回写数据库）
  // -------------------------------------------------------------------------

  /** 完成一门课程 */
  const completeLesson = async (lessonId: string) => {
    if (!progress.value.completedLessons.includes(lessonId)) {
      progress.value.completedLessons.push(lessonId)
    }
    // 完成后清除断点，避免首页继续提示同一门课
    if (progress.value.lastLessonId === lessonId) {
      progress.value.lastLessonId = null
      progress.value.lastPosition = 0
    }

    checkBadgeUnlock()
    await persist()
    await syncBadges()
  }

  /** 增加学习时长（分钟） */
  const addStudyTime = async (minutes: number) => {
    progress.value.totalStudyTime += Math.max(0, Math.round(minutes))
    checkBadgeUnlock()
    await persist()
    await syncBadges()
  }

  /** 更新正确率 */
  const updateCorrectRate = async (correct: number, total: number) => {
    progress.value.correctRate = total > 0 ? correct / total : 0
    if (progress.value.correctRate === 1) {
      checkBadgeUnlock()
    }
    await persist()
    if (progress.value.correctRate === 1) {
      await syncBadges()
    }
  }

  /**
   * 完成一门课程的收尾处理（批量版）。
   * 一次性更新学习时长 / 正确率 / 完成列表，只产生一次数据库写入 + 一次勋章判定，
   * 避免逐项调用造成的请求放大。
   */
  const finishLesson = async (
    lessonId: string,
    correct: number,
    total: number,
    studyMinutes: number,
  ) => {
    progress.value.totalStudyTime += Math.max(0, Math.round(studyMinutes))
    progress.value.correctRate = total > 0 ? correct / total : 0

    if (!progress.value.completedLessons.includes(lessonId)) {
      progress.value.completedLessons.push(lessonId)
    }
    // 完成后清除断点，避免首页继续提示同一门课
    if (progress.value.lastLessonId === lessonId) {
      progress.value.lastLessonId = null
      progress.value.lastPosition = 0
    }

    checkBadgeUnlock()
    await persist()
    await syncBadges()
  }

  /**
   * 记录一次答题。
   * 同时按 SM-2 更新该题的复习计划（错题本与间隔重复的数据来源）。
   * 返回下次复习间隔，便于 UI 做即时反馈。
   */
  const recordQuestionAnswer = async (
    questionId: string,
    answer: number | null,
    isCorrect: boolean,
  ) => {
    return recordAnswerWithSm2(userId.value, questionId, answer, isCorrect)
  }

  /** 保存断点（进入课程、切换题目时调用） */
  const setResumePoint = async (lessonId: string, position: number) => {
    progress.value.lastLessonId = lessonId
    progress.value.lastPosition = position
    progress.value.lastStudiedAt = new Date().toISOString()

    if (canSync.value) {
      await saveResumePoint(userId.value, lessonId, position)
    }
  }

  // -------------------------------------------------------------------------
  // 认证
  // -------------------------------------------------------------------------

  /**
   * 游客模式的持久化标记。
   * 游客不写数据库，但必须记住「我是游客」，否则刷新页面就会
   * 因为拿不到 Supabase 会话而被路由守卫踢回登录页。
   */
  const GUEST_FLAG = 'hq:guest-mode'

  // -------------------------------------------------------------------------
  // 认证
  // -------------------------------------------------------------------------

  /** 注册 */
  const register = async (email: string, password: string, displayName?: string) => {
    loading.value = true
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: displayName || email.split('@')[0],
          },
        },
      })

      if (error) throw error

      // 关键：只有拿到 session 才算真正登录。
      // 开启「邮箱确认」时 signUp 返回 user 但 session 为 null，
      // 此时用户尚未登录，必须等邮箱验证。
      const hasSession = Boolean(data.session)

      if (data.user) {
        const userMetadata = data.user.user_metadata as { username?: string } | undefined
        const emailPrefix = email.split('@')[0] || '用户'

        if (hasSession) {
          user.value = data.user
          session.value = data.session
          userId.value = data.user.id
          username.value = userMetadata?.username || emailPrefix
          isLoggedIn.value = true
          progress.value = emptyProgress(data.user.id)
          await loadFromDatabase()
        }
      }

      return { data, error: null, needsConfirmation: !hasSession }
    } catch (error) {
      return { data: null, error: error as Error, needsConfirmation: false }
    } finally {
      loading.value = false
    }
  }

  /** 重发注册确认邮件 */
  const resendConfirmation = async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) throw error
      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  }

  /** 登录 */
  const login = async (email: string, password: string) => {
    loading.value = true
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      if (data.user && data.session) {
        user.value = data.user
        session.value = data.session
        userId.value = data.user.id
        const userMetadata = data.user.user_metadata as { username?: string } | undefined
        username.value = userMetadata?.username || email.split('@')[0] || '历史学习者'
        isLoggedIn.value = true

        await loadFromDatabase()
      }

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    } finally {
      loading.value = false
    }
  }

  /** 游客模式（纯内存，不写库；但用 localStorage 保持登录态） */
  const loginAsGuest = () => {
    try {
      localStorage.setItem(GUEST_FLAG, '1')
    } catch {
      // 隐私模式下 localStorage 可能不可用，降级为仅内存
    }
    userId.value = 'guest'
    username.value = '游客'
    role.value = 'student'
    isLoggedIn.value = true
    progress.value = emptyProgress('guest')
  }

  /** 登出 */
  const logout = async () => {
    try {
      localStorage.removeItem(GUEST_FLAG)
      localStorage.removeItem(ROLE_CACHE_KEY)
    } catch {
      // 忽略
    }

    const wasGuest = userId.value === 'guest'

    loading.value = true
    try {
      // 游客没有 Supabase 会话，不需要（也不应该）调用 signOut
      if (!wasGuest) {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      }

      user.value = null
      session.value = null
      userId.value = 'user-001'
      username.value = '历史学习者'
      role.value = 'student'
      isLoggedIn.value = false
      progress.value = emptyProgress('user-001')
    } catch (error) {
      console.error('登出错误:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 初始化（恢复会话 + 拉取进度）。
   * 幂等：重复调用复用同一个 Promise，避免并发初始化。
   */
  const doInit = async () => {
    loading.value = true
    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (currentSession?.user) {
        user.value = currentSession.user
        session.value = currentSession
        userId.value = currentSession.user.id
        username.value =
          (currentSession.user.user_metadata?.username as string) ||
          currentSession.user.email?.split('@')[0] ||
          '历史学习者'
        isLoggedIn.value = true

        await loadFromDatabase()
      } else {
        // 没有 Supabase 会话，但之前选择过游客模式 → 恢复游客身份，
        // 避免刷新页面时被路由守卫踢回登录页
        let isGuest = false
        try {
          isGuest = localStorage.getItem(GUEST_FLAG) === '1'
        } catch {
          // 忽略
        }

        if (isGuest) {
          userId.value = 'guest'
          username.value = '游客'
          isLoggedIn.value = true
          progress.value = emptyProgress('guest')
        }
      }

      // 监听认证状态变化（包括邮件确认链接回跳后的自动登录）
      supabase.auth.onAuthStateChange(async (_event, authSession) => {
        if (authSession?.user) {
          user.value = authSession.user
          session.value = authSession
          userId.value = authSession.user.id
          const userMetadata = authSession.user.user_metadata as { username?: string } | undefined
          username.value =
            userMetadata?.username || authSession.user.email?.split('@')[0] || '历史学习者'
          isLoggedIn.value = true
          await loadFromDatabase()
        } else {
          // 仅当不是游客时才重置为未登录
          let isGuest = false
          try {
            isGuest = localStorage.getItem(GUEST_FLAG) === '1'
          } catch {
            // 忽略
          }
          if (isGuest) return

          user.value = null
          session.value = null
          userId.value = 'user-001'
          username.value = '历史学习者'
          isLoggedIn.value = false
          progress.value = emptyProgress('user-001')
        }
      })
    } catch (error) {
      console.error('初始化用户状态错误:', error)
    } finally {
      initialized.value = true
      loading.value = false
    }
  }

  let initPromise: Promise<void> | null = null

  /** 初始化（幂等） */
  const init = (): Promise<void> => {
    if (!initPromise) initPromise = doInit()
    return initPromise
  }

  /** 供路由守卫调用：确保认证状态已就绪 */
  const ensureInitialized = (): Promise<void> => init()

  // 自动初始化一次
  void init()

  return {
    // 身份
    userId,
    username,
    isLoggedIn,
    user,
    session,
    loading,
    initialized,
    role,
    isAdmin,
    // 进度
    progress,
    badges,
    unlockedBadges,
    resumeTarget,
    canSync,
    // 同步
    loadFromDatabase,
    syncBadges,
    persist,
    // 进度更新
    completeLesson,
    addStudyTime,
    updateCorrectRate,
    finishLesson,
    recordQuestionAnswer,
    setResumePoint,
    // 认证
    register,
    resendConfirmation,
    login,
    loginAsGuest,
    logout,
    init,
    ensureInitialized,
  }
})
