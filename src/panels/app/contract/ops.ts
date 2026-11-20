// What a view asks of an app session (spec 008 P1). The grant card travels as
// ops: the view asks the user, the session acts.

export type AppOp = { kind: 'grant' } | { kind: 'refuse' } | { kind: 'reload' }
