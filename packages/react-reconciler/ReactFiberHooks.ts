import { Dispatcher, Fiber } from './ReactInternalTypes'
import { ReactSharedInternals } from '../shared/ReactSharedInternals'
import {
  isInterleavedUpdate,
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from './ReactFiberWorkLoop'
import {
  isSubsetOfLanes,
  Lane,
  Lanes,
  mergeLanes,
  NoLane,
  NoLanes,
  removeLanes,
} from './ReactFiberLane'
import { markWorkInProgressReceivedUpdate } from './ReactFiberBeginWork'
import {
  Flags as FiberFlags,
  Flags,
  Passive as PassiveEffect,
  Update as UpdateEffect,
} from './ReactFiberFlags'
import {
  HookFlags,
  Passive as HookPassive,
  HasEffect as HookHasEffect,
  Layout as HookLayout,
} from './ReactHookEffectTags'
import { pushInterleavedQueue } from './ReactFiberInterleavedUpdates'

const { ReactCurrentDispatcher } = ReactSharedInternals
type BasicStateAction<S> = ((a: S) => S) | S

type Dispatch<A> = (a: A) => void

export type Hook = {
  next: Hook | null
  memoizedState: any
  baseState: any
  queue: UpdateQueue<any, any> | null
  baseQueue: Update<any, any> | null
}

export type FunctionComponentUpdateQueue = {
  lastEffect: Effect | null
}

export type Effect = {
  tag: HookFlags
  create: () => (() => void) | void
  destroy: (() => void) | void
  deps: unknown[] | null
  next: Effect
}

let workInProgressHook: Hook | null = null
let currentlyRenderingFiber: Fiber
let currentHook: Hook | null = null
let renderLanes: Lanes = NoLanes

const mountWorkInProgressHook = (): Hook => {
  const hook: Hook = {
    next: null,
    memoizedState: null,
    baseState: null,
    queue: null,
    baseQueue: null,
  }

  if (workInProgressHook === null) {
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook
  } else {
    workInProgressHook = workInProgressHook.next = hook
  }

  return workInProgressHook
}

type Update<S, A> = {
  action: A
  next: Update<S, A>
  lane: Lane
}

export type UpdateQueue<S, A> = {
  pending: Update<S, A> | null
  lastRenderedReducer: ((s: S, a: A) => S) | null
  lastRenderedState: S | null
  dispatch: null | ((a: A) => any)
  interleaved: Update<S, A> | null
}

const dispatchAction = <S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A
) => {
  const alternate = fiber.alternate
  const lane = requestUpdateLane(fiber)
  const eventTime = requestEventTime()

  const update: Update<S, A> = {
    action,
    next: null as any,
    lane,
  }
  if (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  ) {
    //todo
    throw new Error('Not Implement')
  } else {
    // try {
    //   throw new Error('beforeisInterleavedUpdate stack info')
    // } catch (e) {
    //   console.log(e)
    // }
    // console.log('beforeisInterleavedUpdate', fiber, lane)
    if (isInterleavedUpdate(fiber, lane)) {
      const interleaved = queue.interleaved
      if (interleaved === null) {
        update.next = update
        pushInterleavedQueue(queue)
      } else {
        update.next = interleaved.next
      }
      queue.interleaved = update
    } else {
      const pending = queue.pending
      if (pending === null) {
        update.next = update
      } else {
        update.next = pending.next
        pending.next = update
      }
      queue.pending = update
    }

    if (
      fiber.lanes === NoLanes &&
      (alternate === null || alternate.lanes === NoLanes)
    ) {
      const lastRenderedReducer = queue.lastRenderedReducer

      if (lastRenderedReducer !== null) {
        try {
          const currentState: S = queue.lastRenderedState as any
          const eagerState = lastRenderedReducer(currentState, action)
          if (Object.is(eagerState, currentState)) {
            return
          }
        } catch (error) {
          // 捕获改异常，他待会还会再render阶段抛出
        }
      }
    }

    scheduleUpdateOnFiber(fiber, lane, eventTime)
  }
}

const basicStateReducer = <S>(state: S, action: BasicStateAction<S>): S => {
  return typeof action === 'function' ? (action as (s: S) => S)(state) : action
}

const mountState = <S>(
  initialState: (() => S) | S
): [S, Dispatch<BasicStateAction<S>>] => {
  const hook = mountWorkInProgressHook()

  if (typeof initialState === 'function') {
    initialState = (initialState as () => S)()
  }

  hook.memoizedState = hook.baseState = initialState

  const queue = (hook.queue = {
    pending: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState,
    dispatch: null,
    interleaved: null,
  })

  const dispatch: Dispatch<BasicStateAction<S>> = (queue.dispatch =
    dispatchAction.bind(null, currentlyRenderingFiber, queue) as any)

  return [hook.memoizedState, dispatch]
}

const updateWorkInProgressHook = (): Hook => {
  /**
   * 这个函数同时处理了普通的updates和render阶段updates两种情况，
   * 所以我们可以假设，已经存在一个hook可clone,或者一个可以当作基础hook的，前一轮work-in-progress中的hook
   * 当我们到达list的结尾时，必须把dispatcher切换至处理mount的
   */
  let nextCurrentHook: null | Hook

  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate
    if (current !== null) {
      nextCurrentHook = current.memoizedState
    } else {
      nextCurrentHook = null
    }
  } else {
    nextCurrentHook = currentHook.next
  }

  let nextWorkInProgressHook: Hook | null

  if (workInProgressHook === null) {
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState
  } else {
    nextWorkInProgressHook = workInProgressHook.next
  }

  if (nextWorkInProgressHook !== null) {
    workInProgressHook = nextWorkInProgressHook
    nextWorkInProgressHook = workInProgressHook.next
    currentHook = nextCurrentHook
  } else {
    currentHook = nextCurrentHook!
    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,
      baseState: currentHook.baseState,
      queue: currentHook.queue,
      next: null,
      baseQueue: currentHook.baseQueue,
    }

    if (workInProgressHook === null) {
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook
    } else {
      workInProgressHook = workInProgressHook.next = newHook
    }
  }

  return workInProgressHook
}

const updateReducer = <S, I, A>(
  reducer: (s: S, a: A) => S,
  initialArg: I,
  init?: (i: I) => S
): [S, Dispatch<A>] => {
  const hook = updateWorkInProgressHook()
  const queue = hook.queue!

  queue.lastRenderedReducer = reducer
  const current: Hook = currentHook as any

  let baseQueue = current.baseQueue

  const pendingQueue = queue.pending

  if (pendingQueue !== null) {
    if (baseQueue !== null) {
      /**
       *  ————
       * |    |
       * |    ↓
       * 2 <- 1
       */
      const baseFirst = baseQueue.next

      /**
       *  ————
       * |    |
       * |    ↓
       * 4 <- 3
       */
      const pendingFirst = pendingQueue.next

      //2.next = 3
      baseQueue.next = pendingFirst
      //4.next = 1
      pendingQueue.next = baseFirst

      /** baseQueue结果
       *  ——————————————
       * |              |
       * |              ↓
       * 2 <- 1 <- 4 <- 3
       */
    }

    current.baseQueue = baseQueue = pendingQueue
    /** baseQueue结果
     *  ——————————————
     * |              |
     * |              ↓
     * 4 <- 3 <- 2 <- 1
     */
    queue.pending = null
  }

  if (baseQueue !== null) {
    const first = baseQueue.next
    let newState = current.baseState

    let newBaseState = null
    let newBaseQueueFirst: Update<S, A> | null = null
    let newBaseQueueLast: Update<S, A> | null = null

    let update = first

    do {
      const updateLane = update.lane

      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        /**
         * 没有足够的优先级，跳过这个update,如果这个是第一个跳过的更新，那么
         * 之前的 update和state就是新的baseUpdate和baseState
         */

        // throw new Error('Not Implement')

        const clone: Update<S, A> = {
          lane: updateLane,
          action: update.action,
          next: null as any,
        }

        if (newBaseQueueFirst === null) {
          newBaseQueueFirst = newBaseQueueLast = clone
          newBaseState = newState
        } else {
          newBaseQueueLast = newBaseQueueLast!.next = clone
        }

        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane
        )
      } else {
        //改更新拥有足够的优先级
        if (newBaseQueueLast !== null) {
          const clone: Update<S, A> = {
            lane: NoLane,
            action: update.action,
            next: null as any,
          }

          newBaseQueueLast.next = clone
          newBaseQueueLast = clone
        }

        const action = update.action
        newState = reducer(newState, action)
      }

      update = update.next
    } while (update !== null && update !== first)

    if (newBaseQueueLast === null) {
      newBaseState = newState
    } else {
      newBaseQueueLast.next = newBaseQueueFirst!
    }

    if (!Object.is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate()
    }
    hook.memoizedState = newState
    hook.baseState = newBaseState
    hook.baseQueue = newBaseQueueLast

    queue.lastRenderedState = newState
  }

  const dispatch: Dispatch<A> = queue.dispatch!
  return [hook.memoizedState, dispatch]
}

const updateState = <S>(
  initialState: (() => S) | S
): [S, Dispatch<BasicStateAction<S>>] => {
  return updateReducer(basicStateReducer, initialState)
}

export const renderWithHooks = <Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
  props: Props,
  secondArg: SecondArg,
  nextRenderLanes: Lanes
) => {
  renderLanes = nextRenderLanes
  currentlyRenderingFiber = workInProgress

  //Function组件每次update是都会将新的effect挂载在上面，如果
  //不清除那么老的effect会一直存在并被调用
  workInProgress.updateQueue = null
  workInProgress.memoizedState = null
  workInProgress.lanes = NoLanes

  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount
      : HooksDispatcherOnUpdate
  //调用函数组件，获取JSX对象
  let children = Component(props, secondArg)

  renderLanes = NoLanes
  currentlyRenderingFiber = null as any

  /**
   * 完成该Function组建后将currentHook,workInProgressHook置为null,否则会导致下次更新
   * 时的workInProgress的memoizedState为null导致后续的更新异常
   */
  currentHook = null
  workInProgressHook = null

  return children
}

const areHookInputsEqual = (
  nextDeps: unknown[],
  prevDeps: unknown[] | null
) => {
  if (prevDeps === null) {
    throw new Error('Not Implement')
  }

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; ++i) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue

    return false
  }

  return true
}

const updateEffectImpl = (
  fiberFlags: FiberFlags,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: unknown[] | void | null
): void => {
  const hook = updateWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps

  let destroy = undefined

  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState
    destroy = prevEffect.destroy
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        hook.memoizedState = pushEffect(hookFlags, create, destroy, nextDeps)
        return
      }
    }
  }

  currentlyRenderingFiber.flags |= fiberFlags
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,
    create,
    destroy,
    nextDeps
  )
}

const updateEffect = (
  create: () => (() => void) | void,
  deps: unknown[] | void | null
): void => {
  return updateEffectImpl(PassiveEffect, HookPassive, create, deps)
}

const pushEffect = (
  tag: HookFlags,
  create: Effect['create'],
  destroy: Effect['destroy'],
  deps: Effect['deps']
) => {
  const effect: Effect = {
    tag,
    create,
    destroy,
    deps,
    next: null as any,
  }

  let componentUpdateQueue: null | FunctionComponentUpdateQueue =
    currentlyRenderingFiber.updateQueue as any

  if (componentUpdateQueue === null) {
    componentUpdateQueue = {
      lastEffect: null,
    }
    currentlyRenderingFiber.updateQueue = componentUpdateQueue
    componentUpdateQueue.lastEffect = effect.next = effect
  } else {
    const lastEffect = componentUpdateQueue.lastEffect
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect
    } else {
      const firstEffect = lastEffect.next
      lastEffect.next = effect
      effect.next = firstEffect
      componentUpdateQueue.lastEffect = effect
    }
  }

  return effect
}

const mountEffectImpl = (
  fiberFlags: FiberFlags,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: unknown[] | void | null
): void => {
  const hook = mountWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps
  currentlyRenderingFiber.flags |= fiberFlags
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,
    create,
    undefined,
    nextDeps
  )
}

const mountEffect = (
  create: () => (() => void) | void,
  deps: unknown[] | void | null
) => {
  return mountEffectImpl(PassiveEffect, HookPassive, create, deps)
}

const mountLayoutEffect = (
  create: () => (() => void) | void,
  deps: unknown[] | void | null
) => {
  let fiberFlags: Flags = UpdateEffect
  return mountEffectImpl(fiberFlags, HookLayout, create, deps)
}

const updateLayoutEffect = (
  create: () => (() => void) | void,
  deps: unknown[] | void | null
) => {
  return updateEffectImpl(UpdateEffect, HookLayout, create, deps)
}

const HooksDispatcherOnMount: Dispatcher = {
  useState: mountState,
  useEffect: mountEffect,
  useLayoutEffect: mountLayoutEffect,
}

const HooksDispatcherOnUpdate: Dispatcher = {
  useState: updateState,
  useEffect: updateEffect,
  useLayoutEffect: updateLayoutEffect,
}

export const bailoutHooks = (
  current: Fiber,
  workInProgress: Fiber,
  lanes: Lanes
) => {
  workInProgress.updateQueue = current.updateQueue
  workInProgress.flags &= ~(PassiveEffect | UpdateEffect)

  current.lanes = removeLanes(current.lanes, lanes)
}
