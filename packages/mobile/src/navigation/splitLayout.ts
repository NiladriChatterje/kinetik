/**
 * From this window width (dp) the Chat and Profile tabs show a list on the
 * left and the picked chat or page on the right: tablets and unfolded
 * foldables. Phones, which stay in portrait, are all narrower.
 */
export const SPLIT_MIN_WIDTH = 720;

export const isSplitWidth = (width: number) => width >= SPLIT_MIN_WIDTH;

/** The left column: about a third of the screen, 300 to 400 dp. */
export const splitListWidth = (width: number) => Math.round(Math.min(400, Math.max(300, width * 0.36)));
