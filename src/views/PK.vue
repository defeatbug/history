<script setup lang="ts">
/**
 * PK 房间页（路由 /pk/:id）
 * ============================================================================
 * 页面只负责「渲染 + 交互」，所有可信计算都在服务端（迁移 13 的 RPC）：
 *   * 比分、状态、对手进度全部来自 PkMatchDetail，Realtime 变化时静默重拉；
 *   * 答对答错一律使用 pk_submit_answer 返回的 PkAnswerResult.correct_index，
 *     前端永远不会用本地数据去猜「正确答案」（未作答时服务端不下发 correct_index）；
 *   * 状态机：waiting → in_progress → finished / cancelled，另含游客、加载、错误态。
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useFriendStore } from '@/stores/friend'
import type { PkMatchDetail, PkQuestionView } from '@/types/database'
import {
  answerProgress,
  canContinue,
  matchOutcome,
  me,
  myScore,
  nextQuestion,
  opponent,
  opponentFinished,
  opponentScore,
} from '@/utils/pk'

/** 刚提交那道题的判定结果（服务端返回），用于即时展示对错、正确答案与解析 */
type RevealedAnswer = {
  selectedIndex: number
  correctIndex: number
  isCorrect: boolean
}

/** 逐题复盘的一行 */
type ReviewRow = {
  index: number
  question: PkQuestionView
  selectedIndex: number | null
  correctIndex: number | null
  isCorrect: boolean | null
  explanation: string | null
}

const route = useRoute()
const router = useRouter()
const friendStore = useFriendStore()

const { loadingMatch, submitting, error, isGuest } = storeToRefs(friendStore)

/**
 * currentMatch 单独取一份 computed：
 * store 里是 null / 对象，页面内统一收敛为 PkMatchDetail | null，模板里就不用反复判空。
 */
const currentMatch = computed<PkMatchDetail | null>(() => friendStore.currentMatch)

const routeMatchId = computed(() => {
  const value = route.params.id
  return typeof value === 'string' ? value : ''
})

/** 当前路由对应的对战。store.currentMatch 可能还留着上一场，按 id 对齐避免串场 */
const match = computed<PkMatchDetail | null>(() => {
  const detail = currentMatch.value
  if (!detail) return null
  if (!routeMatchId.value || detail.id !== routeMatchId.value) return null
  return detail
})

/**
 * 首屏尚未拿到数据（或正在切对战）时显示整页加载。
 * 只有「还没有当前对战」时才整页转圈：已进入房间后的刷新（如应战、重试）
 * 不应该把正在看的比分/题目替换成 loading。
 */
const isLoading = computed(
  () => !match.value && routeMatchId.value !== '' && (loadingMatch.value || error.value === null),
)
/** 没有匹配的对战时，error 才是致命的（对战不存在 / 无权限） */
const fatalError = computed(() => (match.value ? null : error.value))

const isChallenger = computed(() => match.value?.my_role === 'challenger')
const my = computed(() => (match.value ? me(match.value) : null))
const rival = computed(() => (match.value ? opponent(match.value) : null))
const myPoints = computed(() => (match.value ? myScore(match.value) : 0))
const rivalPoints = computed(() => (match.value ? opponentScore(match.value) : 0))
const totalQuestions = computed(() => match.value?.questions.length ?? 0)
const progress = computed(() =>
  match.value ? answerProgress(match.value) : { answered: 0, total: 0, percent: 0 },
)
const rivalPercent = computed(() => {
  const detail = match.value
  if (!detail || totalQuestions.value === 0) return 0
  return Math.round((detail.opponent_answered / totalQuestions.value) * 100)
})
const rivalDone = computed(() => (match.value ? opponentFinished(match.value) : false))
const rivalInitial = computed(() => {
  const name = rival.value?.username?.trim()
  return name ? name.charAt(0).toUpperCase() : '?'
})
const outcome = computed(() =>
  matchOutcome(myPoints.value, rivalPoints.value, match.value?.status ?? 'waiting'),
)

const STATUS_LABELS: Record<PkMatchDetail['status'], string> = {
  waiting: '等待应战',
  in_progress: '对战中',
  finished: '已结束',
  cancelled: '已取消',
}

const OUTCOME_META = {
  win: { emoji: '🏆', title: '恭喜获胜！', subtitle: '你的历史知识更胜一筹' },
  lose: { emoji: '💪', title: '惜败一局', subtitle: '继续学习，下次一定能赢' },
  draw: { emoji: '🤝', title: '平局', subtitle: '势均力敌，都很精彩' },
  pending: { emoji: '⏳', title: '对战进行中', subtitle: '结果很快就会出来' },
} as const
const outcomeMeta = computed(() => OUTCOME_META[outcome.value])

// ---------------------------------------------------------------------------
// 本地交互状态
// ---------------------------------------------------------------------------
/** 本次进入页面后由服务端判定返回的答案（key = question_id） */
const revealed = ref<Record<string, RevealedAnswer>>({})
/** 答完一题后停在这道题上展示判定，等用户点「下一题」再前进 */
const activeQuestionId = ref<string | null>(null)
/** 正在提交的选项下标（禁用 + 高亮） */
const pendingIndex = ref<number | null>(null)
/** 应战 / 拒绝 / 取消挑战的进行中状态（与答题的 submitting 区分） */
const actionBusy = ref(false)
/** 结束后逐题复盘是否展开 */
const showReview = ref(true)
/** 用于丢弃上一场对战未完成的加载 */
let loadToken = 0

/** 当前展示的题：优先停在刚答完的那道（展示判定），否则取下一道未答题 */
const currentQuestion = computed<PkQuestionView | null>(() => {
  const detail = match.value
  if (!detail) return null
  if (activeQuestionId.value) {
    const held = detail.questions.find((question) => question.id === activeQuestionId.value)
    if (held) return held
  }
  return nextQuestion(detail)
})
const currentIndex = computed(() => {
  const detail = match.value
  const question = currentQuestion.value
  if (!detail || !question) return 0
  const index = detail.questions.findIndex((item) => item.id === question.id)
  return index >= 0 ? index + 1 : 0
})
const currentOptions = computed<string[]>(() =>
  currentQuestion.value ? optionTexts(currentQuestion.value.options) : [],
)
/** 当前题的判定：本地刚提交的结果优先，其次从服务端已揭示的数据还原 */
const currentFeedback = computed<RevealedAnswer | null>(() => {
  const detail = match.value
  const question = currentQuestion.value
  if (!detail || !question) return null
  const local = revealed.value[question.id]
  if (local) return local
  const mine = detail.my_answers.find((answer) => answer.question_id === question.id)
  if (mine && question.correct_index !== null) {
    return {
      selectedIndex: mine.selected_index,
      correctIndex: question.correct_index,
      isCorrect: mine.is_correct,
    }
  }
  return null
})
const currentExplanation = computed(() => {
  const text = currentQuestion.value?.explanation?.trim()
  return text ? text : null
})
/** 未提交且本题未答过才可选 */
const canAnswer = computed(
  () =>
    match.value?.status === 'in_progress' && currentFeedback.value === null && !submitting.value,
)
const hasNextQuestion = computed(() => (match.value ? canContinue(match.value) : false))

/** 逐题复盘数据：答案与对错全部取自服务端，correct_index 在结束后必定已返回 */
const reviewRows = computed<ReviewRow[]>(() => {
  const detail = match.value
  if (!detail) return []
  return detail.questions.map((question, index) => {
    const mine = detail.my_answers.find((answer) => answer.question_id === question.id)
    const local = revealed.value[question.id]
    const explanation = question.explanation?.trim()
    return {
      index: index + 1,
      question,
      selectedIndex: mine?.selected_index ?? local?.selectedIndex ?? null,
      correctIndex: question.correct_index ?? local?.correctIndex ?? null,
      isCorrect: mine?.is_correct ?? local?.isCorrect ?? null,
      explanation: explanation ? explanation : null,
    }
  })
})

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------
function optionTexts(options: PkQuestionView['options']): string[] {
  if (Array.isArray(options)) {
    return options.map((option) => (typeof option === 'string' ? option : String(option ?? '')))
  }
  if (options && typeof options === 'object') {
    return Object.values(options).map((value) => String(value ?? ''))
  }
  return []
}

function letter(index: number): string {
  return String.fromCharCode(65 + index)
}

function optionLabel(question: PkQuestionView, index: number | null): string {
  if (index === null || index < 0) return '未作答'
  const texts = optionTexts(question.options)
  return texts[index] ?? `${letter(index)} 选项`
}

function correctAnswerText(question: PkQuestionView, index: number | null): string {
  if (index === null || index < 0) return '未公布'
  const texts = optionTexts(question.options)
  return `${letter(index)}. ${texts[index] ?? ''}`.trim()
}

function optionClass(index: number): string {
  const feedback = currentFeedback.value
  if (feedback) {
    if (index === feedback.correctIndex) return 'border-green-500 bg-green-50 shadow-sm'
    if (index === feedback.selectedIndex) return 'border-red-400 bg-red-50'
    return 'border-gray-200 bg-gray-50 opacity-60'
  }
  if (pendingIndex.value === index) return 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
  return 'border-gray-200 bg-white hover:border-amber-400 hover:bg-amber-50/60 hover:shadow-md'
}

function optionBadgeClass(index: number): string {
  const feedback = currentFeedback.value
  if (feedback) {
    if (index === feedback.correctIndex) return 'bg-green-500 text-white'
    if (index === feedback.selectedIndex) return 'bg-red-500 text-white'
    return 'bg-gray-100 text-gray-500'
  }
  if (pendingIndex.value === index) return 'bg-amber-500 text-white'
  return 'bg-amber-100 text-amber-700'
}

function markIcon(index: number): string {
  const feedback = currentFeedback.value
  if (!feedback) return ''
  if (index === feedback.correctIndex) return '✓'
  if (index === feedback.selectedIndex) return '✗'
  return ''
}

function reviewBadgeText(row: ReviewRow): string {
  if (row.isCorrect === true) return '答对'
  if (row.isCorrect === false) return '答错'
  return '未作答'
}

function reviewBadgeClass(row: ReviewRow): string {
  const base = 'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold'
  if (row.isCorrect === true) return `${base} bg-green-100 text-green-700`
  if (row.isCorrect === false) return `${base} bg-red-100 text-red-600`
  return `${base} bg-gray-100 text-gray-500`
}

// ---------------------------------------------------------------------------
// 行为
// ---------------------------------------------------------------------------
function resetLocalState(): void {
  revealed.value = {}
  activeQuestionId.value = null
  pendingIndex.value = null
  actionBusy.value = false
  showReview.value = true
}

function goFriends(): void {
  void router.push('/friends')
}

function retryLoad(): void {
  void enterMatch(routeMatchId.value)
}

/** 进入某场对战：订阅 Realtime + 拉取详情（游客不发起任何请求） */
async function enterMatch(matchId: string): Promise<void> {
  if (!matchId || isGuest.value) return
  const token = ++loadToken
  // 先订阅再拉取：加载过程中对手应战 / 答题也能收到通知
  friendStore.bindMatchRealtime(matchId)
  await friendStore.loadMatch(matchId)
  if (token !== loadToken) return
  // 极端情况下 store 可能被更早发出的请求覆盖，这里以当前路由为准再对齐一次
  if (currentMatch.value?.id !== matchId) {
    await friendStore.loadMatch(matchId)
  }
}

/** 选中一个选项：提交给服务端，用返回的 correct_index 展示判定 */
async function chooseOption(index: number): Promise<void> {
  const detail = match.value
  const question = currentQuestion.value
  if (!detail || !question || !canAnswer.value) return

  pendingIndex.value = index
  try {
    const result = await friendStore.submitAnswer(detail.id, question.id, index)

    if (result.already_answered) {
      // 别的设备/标签页已经答过：不伪造本地选择，直接以服务端记录为准
      activeQuestionId.value = question.id
      await friendStore.loadMatch(detail.id, true)
      toast.info('这道题你已经答过了')
      return
    }

    revealed.value = {
      ...revealed.value,
      [question.id]: {
        selectedIndex: index,
        correctIndex: result.correct_index,
        isCorrect: result.is_correct,
      },
    }
    activeQuestionId.value = question.id

    if (result.my_finished && !result.opponent_finished) {
      toast.info('你已答完全部题目，等待对手完成')
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '提交答案失败，请重试')
    // 超时等场景下服务端可能已经写入，重拉一次对齐状态
    await friendStore.loadMatch(detail.id, true)
  } finally {
    pendingIndex.value = null
  }
}

function advance(): void {
  const answeredId = activeQuestionId.value
  activeQuestionId.value = null
  pendingIndex.value = null
  // 若提交成功但随后的静默刷新失败，本地 match 里还没有这条答案，
  // nextQuestion 会再次返回同一道题；此时补一次刷新与服务端对齐。
  const detail = match.value
  if (answeredId && detail && !detail.my_answers.some((a) => a.question_id === answeredId)) {
    void friendStore.loadMatch(detail.id, true)
  }
}

async function respondToChallenge(accept: boolean): Promise<void> {
  const detail = match.value
  if (!detail || actionBusy.value) return
  actionBusy.value = true
  try {
    await friendStore.respondToMatch(detail.id, accept)
    if (accept) {
      toast.success('已应战，开始答题！')
    } else {
      toast.info('已拒绝挑战')
      await friendStore.loadMatch(detail.id, true)
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '操作失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

async function cancelChallenge(): Promise<void> {
  const detail = match.value
  if (!detail || actionBusy.value) return
  actionBusy.value = true
  try {
    await friendStore.cancelMatchById(detail.id)
    toast.info('已取消挑战')
    await router.push('/friends')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '取消挑战失败')
  } finally {
    actionBusy.value = false
  }
}

// ---------------------------------------------------------------------------
// 生命周期 / 路由切换
// ---------------------------------------------------------------------------
onMounted(() => {
  void enterMatch(routeMatchId.value)
})

onUnmounted(() => {
  loadToken += 1
  friendStore.unbindMatchRealtime()
})

watch(routeMatchId, (nextId, prevId) => {
  if (!nextId || nextId === prevId) return
  loadToken += 1
  resetLocalState()
  friendStore.unbindMatchRealtime()
  void enterMatch(nextId)
})

// 对战结束时给一个轻提示（首次进入已结束的对战不提示）
watch(
  () => match.value?.status,
  (next, prev) => {
    if (next === 'finished' && prev !== undefined && prev !== 'finished' && prev !== 'cancelled') {
      toast.success('对战结束，快来看看结果吧')
    }
  },
)

// 防御：同页快速切换对战时，旧请求若最后返回，会覆盖 store；此时按当前路由重拉
watch(currentMatch, (value) => {
  if (!value || isGuest.value || loadingMatch.value) return
  const routeId = routeMatchId.value
  if (routeId && value.id !== routeId) {
    void friendStore.loadMatch(routeId, true)
  }
})
</script>

<template>
  <!-- 游客：登录引导 -->
  <div v-if="isGuest" class="mx-auto max-w-xl space-y-6 py-4 text-center">
    <div class="text-6xl">⚔️</div>
    <h1
      class="bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-3xl font-bold text-transparent"
    >
      历史知识 PK
    </h1>
    <div class="rounded-2xl border border-gray-100 bg-white p-8 shadow-xl">
      <p class="text-gray-700">登录后即可与好友进行历史知识 PK，实时对战、同步比分。</p>
      <p class="mt-2 text-sm text-gray-500">游客模式下无法接收挑战，对战记录也不会保存。</p>
      <div class="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <router-link
          to="/login"
          class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
        >
          去登录
        </router-link>
        <router-link
          to="/friends"
          class="rounded-xl border-2 border-amber-200 bg-white px-6 py-3 font-bold text-amber-700 transition-all hover:bg-amber-50"
        >
          返回好友页
        </router-link>
      </div>
    </div>
  </div>

  <div v-else class="mx-auto max-w-3xl space-y-6">
    <!-- 加载中 -->
    <div
      v-if="isLoading"
      class="rounded-2xl border border-gray-100 bg-white p-16 text-center shadow-xl"
    >
      <div
        class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-amber-200 border-t-amber-500"
        role="status"
        aria-label="加载中"
      ></div>
      <p class="mt-4 text-gray-600">正在进入 PK 房间...</p>
    </div>

    <!-- 加载失败 / 对战不存在 / 无权限 -->
    <div
      v-else-if="fatalError"
      class="space-y-4 rounded-2xl border border-red-100 bg-white p-10 text-center shadow-xl"
    >
      <div class="text-6xl">😵</div>
      <h2 class="text-2xl font-bold text-gray-800">无法打开这场对战</h2>
      <p class="text-gray-600">{{ fatalError }}</p>
      <p class="text-sm text-gray-400">对战可能不存在、已被取消，或者你不是这场对战的参与者。</p>
      <div class="flex flex-wrap justify-center gap-3 pt-2">
        <button
          type="button"
          class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
          @click="retryLoad"
        >
          重试
        </button>
        <button
          type="button"
          class="rounded-xl border-2 border-amber-200 bg-white px-6 py-3 font-bold text-amber-700 transition-all hover:bg-amber-50"
          @click="goFriends"
        >
          返回好友页
        </button>
      </div>
    </div>

    <!-- 没有对战数据（既没报错也没加载） -->
    <div
      v-else-if="!match"
      class="space-y-4 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-xl"
    >
      <div class="text-6xl">🔍</div>
      <h2 class="text-2xl font-bold text-gray-800">没有找到这场对战</h2>
      <p class="text-gray-600">请从好友页重新发起或进入一场对战。</p>
      <button
        type="button"
        class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
        @click="goFriends"
      >
        返回好友页
      </button>
    </div>

    <!-- 房间主体 -->
    <template v-else>
      <div class="flex items-center justify-between gap-4">
        <h1
          class="bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-2xl font-bold text-transparent md:text-3xl"
        >
          历史知识 PK
        </h1>
        <span
          class="shrink-0 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm"
        >
          {{ STATUS_LABELS[match.status] }}
        </span>
      </div>

      <!-- 静默刷新失败时的页内提示，不打断正在看的对战 -->
      <div
        v-if="error"
        class="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
      >
        <span class="flex-1">{{ error }}</span>
        <button type="button" class="shrink-0 font-semibold underline" @click="retryLoad">
          重试
        </button>
      </div>

      <!-- ============================ waiting ============================ -->
      <section
        v-if="match.status === 'waiting'"
        class="space-y-6 rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 p-8 text-center shadow-xl"
      >
        <div class="text-6xl">{{ isChallenger ? '⏳' : '⚔️' }}</div>
        <h2 class="text-2xl font-bold text-gray-800">
          {{ isChallenger ? '等待对手应战' : '你收到一个挑战' }}
        </h2>
        <p class="text-gray-600">
          {{
            isChallenger
              ? `已向 ${rival?.username || '好友'} 发起挑战，等待应战`
              : `${rival?.username || '对方'} 向你发起挑战，应战后立即开始作答`
          }}
        </p>

        <div
          class="inline-flex items-center gap-3 rounded-2xl border border-amber-100 bg-white px-5 py-3 shadow-sm"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 font-bold text-white"
          >
            {{ rivalInitial }}
          </div>
          <div class="text-left">
            <p class="text-xs text-gray-500">{{ isChallenger ? '对手' : '挑战者' }}</p>
            <p class="font-bold text-gray-800">{{ rival?.username || '对手' }}</p>
          </div>
        </div>

        <div class="flex flex-wrap justify-center gap-3 pt-2">
          <template v-if="isChallenger">
            <button
              type="button"
              :disabled="actionBusy"
              class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
              @click="cancelChallenge"
            >
              {{ actionBusy ? '取消中...' : '取消挑战' }}
            </button>
            <button
              type="button"
              class="rounded-xl border-2 border-amber-200 bg-white px-6 py-3 font-bold text-amber-700 transition-all hover:bg-amber-50"
              @click="goFriends"
            >
              返回好友页
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              :disabled="actionBusy"
              class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
              @click="respondToChallenge(true)"
            >
              {{ actionBusy ? '处理中...' : '应战' }}
            </button>
            <button
              type="button"
              :disabled="actionBusy"
              class="rounded-xl border-2 border-red-200 bg-white px-8 py-3 font-bold text-red-600 transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              @click="respondToChallenge(false)"
            >
              拒绝
            </button>
          </template>
        </div>

        <p class="text-xs text-gray-500">页面会自动刷新，对方应战后立即进入答题。</p>
      </section>

      <!-- =========================== in_progress ========================= -->
      <template v-else-if="match.status === 'in_progress'">
        <!-- 实时比分条 -->
        <section
          class="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 p-6 shadow-xl"
        >
          <div class="flex items-center justify-between text-xs text-gray-600">
            <span class="inline-flex items-center gap-2">
              <span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
              实时对战
            </span>
            <span class="rounded-full bg-white/70 px-2.5 py-1 font-semibold text-amber-700">
              共 {{ totalQuestions }} 题
            </span>
          </div>

          <div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div class="text-center">
              <p class="truncate text-sm text-gray-600">{{ my?.username || '我' }}</p>
              <Transition name="score-pop" mode="out-in">
                <p :key="myPoints" class="inline-block text-4xl font-bold text-amber-600">
                  {{ myPoints }}
                </p>
              </Transition>
              <p class="mt-1 text-xs text-amber-700">我</p>
            </div>
            <div class="font-black text-gray-300">VS</div>
            <div class="text-center">
              <p class="truncate text-sm text-gray-600">{{ rival?.username || '对手' }}</p>
              <Transition name="score-pop" mode="out-in">
                <p :key="rivalPoints" class="inline-block text-4xl font-bold text-blue-600">
                  {{ rivalPoints }}
                </p>
              </Transition>
              <p class="mt-1 text-xs text-gray-500">对手</p>
            </div>
          </div>

          <div class="mt-5 space-y-1.5">
            <div class="flex justify-between text-xs text-gray-600">
              <span>我的进度</span>
              <span class="font-semibold text-amber-700">
                {{ progress.answered }} / {{ progress.total }}
              </span>
            </div>
            <div class="h-2.5 overflow-hidden rounded-full bg-gray-200">
              <div
                class="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                :style="{ width: `${progress.percent}%` }"
              ></div>
            </div>
          </div>

          <div class="mt-3 space-y-1.5">
            <div class="flex justify-between text-xs text-gray-600">
              <span>对手进度（不显示选项）</span>
              <span class="font-semibold text-blue-600">
                {{ match.opponent_answered }} / {{ totalQuestions }}
                <span v-if="rivalDone" class="ml-1 text-green-600">· 已完成</span>
              </span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                class="h-full rounded-full bg-gradient-to-r from-blue-400 to-indigo-400 transition-all duration-500"
                :style="{ width: `${rivalPercent}%` }"
              ></div>
            </div>
          </div>
        </section>

        <!-- 已答完、等待对手 -->
        <div
          v-if="!currentQuestion"
          class="space-y-4 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-xl"
        >
          <div class="animate-pulse text-6xl">⏳</div>
          <h2 class="text-2xl font-bold text-gray-800">你已完成答题</h2>
          <p class="text-gray-600">
            等待 {{ rival?.username || '对手' }} 完成（{{ match.opponent_answered }} /
            {{ totalQuestions }} 题）
          </p>
          <p class="inline-flex items-center gap-2 text-sm text-amber-600">
            <span class="h-2 w-2 animate-bounce rounded-full bg-amber-500"></span>
            对手提交后比分与结果会自动刷新
          </p>
          <button
            type="button"
            class="rounded-xl border-2 border-amber-200 bg-white px-6 py-3 font-bold text-amber-700 transition-all hover:bg-amber-50"
            @click="goFriends"
          >
            返回好友页
          </button>
        </div>

        <!-- 当前题 -->
        <div v-else class="rounded-2xl border border-gray-100 bg-white p-6 shadow-xl md:p-8">
          <div class="mb-4 flex items-center justify-between gap-3">
            <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              第 {{ currentIndex }} 题 / {{ totalQuestions }}
            </span>
            <span v-if="currentQuestion.course_title" class="truncate text-xs text-gray-500">
              {{ currentQuestion.course_title }}
            </span>
          </div>

          <h2 class="mb-6 text-xl font-bold leading-relaxed text-gray-800 md:text-2xl">
            {{ currentQuestion.content }}
          </h2>

          <div class="space-y-3">
            <button
              v-for="(option, index) in currentOptions"
              :key="index"
              type="button"
              :disabled="!canAnswer"
              :class="[
                'flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
                optionClass(index),
                canAnswer ? 'cursor-pointer' : 'cursor-not-allowed',
              ]"
              @click="chooseOption(index)"
            >
              <span
                :class="[
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                  optionBadgeClass(index),
                ]"
              >
                {{ letter(index) }}
              </span>
              <span class="font-medium text-gray-800">{{ option }}</span>
              <span v-if="markIcon(index)" class="ml-auto text-xl font-bold">
                {{ markIcon(index) }}
              </span>
            </button>
          </div>

          <p v-if="submitting" class="mt-4 text-sm text-gray-500">正在提交答案...</p>

          <!-- 判定结果 + 解析 -->
          <div v-if="currentFeedback" class="mt-6 space-y-3 border-t border-gray-200 pt-6">
            <div class="flex items-center gap-2">
              <span class="text-2xl">{{ currentFeedback.isCorrect ? '✅' : '❌' }}</span>
              <p
                :class="[
                  'font-bold',
                  currentFeedback.isCorrect ? 'text-green-600' : 'text-red-500',
                ]"
              >
                {{ currentFeedback.isCorrect ? '回答正确，+1 分' : '回答错误' }}
              </p>
            </div>

            <p class="text-sm text-gray-600">
              正确答案：
              <span class="font-semibold text-green-700">
                {{ correctAnswerText(currentQuestion, currentFeedback.correctIndex) }}
              </span>
            </p>

            <div
              v-if="currentExplanation"
              class="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm leading-relaxed text-gray-700"
            >
              <span class="font-semibold text-amber-700">解析：</span>{{ currentExplanation }}
            </div>

            <div class="flex justify-end pt-1">
              <button
                type="button"
                class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
                @click="advance"
              >
                {{ hasNextQuestion ? '下一题' : '完成答题' }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ============================= finished ========================== -->
      <template v-else-if="match.status === 'finished'">
        <section
          class="space-y-4 rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 p-8 text-center shadow-xl"
        >
          <div class="text-7xl">{{ outcomeMeta.emoji }}</div>
          <h2 class="text-3xl font-bold text-gray-800">{{ outcomeMeta.title }}</h2>
          <p class="text-gray-600">{{ outcomeMeta.subtitle }}</p>

          <div class="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div class="rounded-2xl bg-white p-4 shadow-sm">
              <p class="truncate text-xs text-gray-500">我 · {{ my?.username || '我' }}</p>
              <p class="text-4xl font-bold text-amber-600">{{ myPoints }}</p>
            </div>
            <span class="font-black text-gray-300">:</span>
            <div class="rounded-2xl bg-white p-4 shadow-sm">
              <p class="truncate text-xs text-gray-500">对手 · {{ rival?.username || '对手' }}</p>
              <p class="text-4xl font-bold text-blue-600">{{ rivalPoints }}</p>
            </div>
          </div>

          <p class="text-sm text-gray-500">
            共 {{ totalQuestions }} 题，我一共答对 {{ myPoints }} 题
          </p>

          <div class="flex justify-center pt-2">
            <button
              type="button"
              class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
              @click="goFriends"
            >
              返回好友页
            </button>
          </div>
        </section>

        <!-- 逐题复盘 -->
        <section class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-amber-50/60"
            @click="showReview = !showReview"
          >
            <span class="font-bold text-gray-800">逐题复盘（{{ reviewRows.length }} 题）</span>
            <span class="text-sm font-semibold text-amber-600">
              {{ showReview ? '收起' : '展开' }}
            </span>
          </button>

          <div v-if="showReview" class="divide-y divide-gray-100 border-t border-gray-100">
            <div v-for="row in reviewRows" :key="row.question.id" class="space-y-2 px-6 py-5">
              <div class="flex items-start justify-between gap-3">
                <p class="font-semibold leading-relaxed text-gray-800">
                  <span class="text-amber-600">第 {{ row.index }} 题</span>
                  <span class="ml-1">{{ row.question.content }}</span>
                </p>
                <span :class="reviewBadgeClass(row)">{{ reviewBadgeText(row) }}</span>
              </div>

              <p class="text-sm text-gray-600">
                我的选择：
                <span
                  :class="
                    row.isCorrect === true
                      ? 'font-semibold text-green-600'
                      : row.isCorrect === false
                        ? 'font-semibold text-red-500'
                        : 'text-gray-400'
                  "
                >
                  {{ optionLabel(row.question, row.selectedIndex) }}
                </span>
              </p>
              <p class="text-sm text-gray-600">
                正确答案：
                <span class="font-semibold text-green-700">
                  {{ correctAnswerText(row.question, row.correctIndex) }}
                </span>
              </p>
              <p
                v-if="row.explanation"
                class="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs leading-relaxed text-gray-600"
              >
                <span class="font-semibold text-amber-700">解析：</span>{{ row.explanation }}
              </p>
            </div>
          </div>
        </section>
      </template>

      <!-- ============================= cancelled ========================= -->
      <section
        v-else-if="match.status === 'cancelled'"
        class="space-y-4 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-xl"
      >
        <div class="text-6xl">🚫</div>
        <h2 class="text-2xl font-bold text-gray-800">对战已取消</h2>
        <p class="text-gray-600">这场对战已被取消，不会记录胜负。</p>
        <button
          type="button"
          class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
          @click="goFriends"
        >
          返回好友页
        </button>
      </section>

      <!-- ============================ 兜底状态 =========================== -->
      <section
        v-else
        class="space-y-4 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-xl"
      >
        <div class="text-6xl">❓</div>
        <h2 class="text-2xl font-bold text-gray-800">对战状态异常</h2>
        <p class="text-gray-600">暂时无法识别这场对战的状态，请稍后重试。</p>
        <button
          type="button"
          class="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-xl"
          @click="retryLoad"
        >
          重试
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* 比分变化时轻轻一跳，不做复杂动画 */
.score-pop-enter-active,
.score-pop-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.score-pop-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(1.12);
}
.score-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.92);
}
</style>
