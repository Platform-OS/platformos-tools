/**
 * Anchored at both ends, and `[\s\S]` rather than `(.|\n)`: the subject is the whole
 * comment source, so a conditional comment's `<!--[if` is always at index 0.
 *
 * Leaving the start unanchored let `<!-- text <!--[if IE]>…<![endif]-->` match with `text`
 * outside the capture groups — which the printer, regenerating the comment from what it
 * captured, then deleted from the author's file. It was also quadratic, since every `<`
 * in the subject is a start position the alternation backtracks across: 634 ms on 120k
 * characters of `<!--[if`, against 0.1 ms here.
 */
const commentRegex = /^(<!--\[if[^\]]*]>)([\s\S]*)(<!\[endif\]-->)$/;

export const getConditionalComment = (comment: string) => {
  const matches = comment.match(commentRegex);
  if (matches) {
    return {
      startTag: matches[1],
      body: matches[2].trim(),
      endTag: matches[3],
    };
  }
};
