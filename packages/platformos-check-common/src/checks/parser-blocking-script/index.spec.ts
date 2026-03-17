import { expect, describe, it } from 'vitest';
import { ParserBlockingScript } from '.';
import { applySuggestions, check as reportOffenses } from '../../test';

describe('Module: ParserBlockingScript', () => {
  it('should report the correct offense when using the script tag', async () => {
    const file = `
        <script src="https://foo.bar/baz.js"></script>
      `;
    const startIndex = file.indexOf('<script');
    const endIndex = file.indexOf('</script>') + '</script>'.length;

    const offenses = await reportOffenses(
      {
        'code.liquid': file,
      },
      [ParserBlockingScript],
    );

    expect(offenses).to.have.length(1);
    const { check, message, start, end } = offenses[0];
    expect(check).to.equal(ParserBlockingScript.meta.code);
    expect(message).to.equal('Avoid parser blocking scripts by adding `defer` or `async` on this tag');
    expect(start.index).to.equal(startIndex);
    expect(end.index).to.equal(endIndex);
  });

  describe('Case: script tag suggestion', () => {
    it('should suggest adding both attributes at the end', async () => {
      const file = `<script src="a.js"></script>`;
      const offenses = await reportOffenses({ 'code.liquid': file }, [ParserBlockingScript]);

      expect(offenses).to.have.length(1);

      const offense = offenses[0];
      expect(offense).to.suggest(file, `Use an HTML script tag with the defer attribute instead`, {
        startIndex: file.indexOf('>'),
        endIndex: file.indexOf('>'),
        insert: ` defer`,
      });
      expect(offense).to.suggest(file, `Use an HTML script tag with the async attribute instead`, {
        startIndex: file.indexOf('>'),
        endIndex: file.indexOf('>'),
        insert: ` async`,
      });

      const suggestions = applySuggestions(file, offense);
      expect(suggestions).to.deep.equal([
        '<script src="a.js" defer></script>',
        '<script src="a.js" async></script>',
      ]);
    });
  });

  describe('No offenses', () => {
    it('should not report any offense when async is set on a script tag', async () => {
      const file = `
        <script src="https://foo.bar/baz.js" async></script>
      `;
      const offenses = await reportOffenses(
        {
          'code.liquid': file,
        },
        [ParserBlockingScript],
      );
      expect(offenses).to.have.length(0);
    });

    it('should not report any offense when defer is set on a script tag', async () => {
      const file = `
        <script src="https://foo.bar/baz.js" defer="defer"></script>
      `;
      const offenses = await reportOffenses(
        {
          'code.liquid': file,
        },
        [ParserBlockingScript],
      );
      expect(offenses).to.have.length(0);
    });

    it('should not report any offense when async and defer are set on a script tag', async () => {
      const file = `
        <script src="https://foo.bar/baz.js" async defer></script>
      `;
      const offenses = await reportOffenses(
        {
          'code.liquid': file,
        },
        [ParserBlockingScript],
      );
      expect(offenses).to.have.length(0);
    });

    it('should not report any offense when using scripts of type module', async () => {
      const file = `
        <script src="https://foo.bar/baz.js" type="module"></script>
        <script src="https://foo.bar/baz.js" type="importmap"></script>
      `;
      const offenses = await reportOffenses(
        {
          'code.liquid': file,
        },
        [ParserBlockingScript],
      );
      expect(offenses).to.have.length(0);
    });
  });
});
