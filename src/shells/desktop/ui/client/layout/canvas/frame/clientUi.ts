// What frame actions ask of the person using this client.

declare module '@kernel/interaction/contract' {
  interface ClientUi {
    /** Asks for a line of text (a frame's new title); null when cancelled.
     *  Optional: a shell without it cannot rename a frame by hand. */
    promptText?(request: { message: string; initial: string }): Promise<string | null>
  }
}

export {}
