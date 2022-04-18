import {useRef, useState, useCallback} from 'react';

// React's built-in useReducer expects the reducer parameter to be a pure function, as it may
// call the reducer multiple times (redundantly) for the same state+action. This is an
// alternative to useReducer that has the same signature, but will only call the reducer function
// once for each action that's dispatched.
// I assume there must be disadvantages to this approach compared to other solutions I've seen, e.g.
// https://github.com/davidkpiano/useEffectReducer
// since this seems much simpler, but I don't know what they are. I must be missing something.
export function useEffectfulReducer<S, A>(reducer: (s: S, a: A, d: (action: A) => void) => S, initialArg: S): [S, (action: A) => void] {
  // The state is stored in useState, in order to trigger re-renders.
  // But the "authoritative" copy is stored with useRef, so that we don't
  // have any issues with see old versions from useState.
  const authoritativeState = useRef(initialArg);
  const [copiedState, setCopiedState] = useState(initialArg);

  // It's possible that the reducer function could initiate an async call, and when it completes
  // want to dispatch an action. In that case, it can safely call dispatch, because the reducer
  // function is not being re-entered. But we wouldn't want the reducer to synchrously call dispatch
  // and re-enter itself. So as a sanity check, we keep an "entered" flag (like a lock/mutex) to
  // make sure this expectation is not violated.
  const entered = useRef(false);

  // The dispatch method we return is memoized so that it's always the same function.
  const memoizedDispatch = useCallback((action) => {
    if (entered.current) {
      throw new Error('Not allowed to synchronously call dispatch inside reducer');
    }
    entered.current = true;
    const newState = reducer(authoritativeState.current, action, memoizedDispatch);
    entered.current = false;
    authoritativeState.current = newState;
    setCopiedState(newState);
  }, [reducer]);

  return [copiedState, memoizedDispatch];
}
