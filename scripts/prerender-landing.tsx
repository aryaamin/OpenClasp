import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const capabilities = [
  'publisher authenticated',
  'contextual intelligence',
  'attested agreements',
  'direct A2A',
  'authenticated outcomes',
  'behavioural profiles',
];

function PrerenderedLanding() {
  return (
    <div className="landingPage">
      <header className="landingNav">
        <a className="landingBrand" href="#top" aria-label="OpenClasp home">
          <strong>openclasp</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">what it knows</a>
          <a href="#intelligence">intelligence</a>
        </nav>
        <div className="landingNavActions">
          <a className="navCta" href="#access">
            sign in →
          </a>
        </div>
      </header>

      <main id="top">
        <section className="landingHero">
          <div className="heroCopy">
            <p className="landingKicker">
              <span>//</span> assurance and behavioural intelligence for AI agents
            </p>
            <h1>
              Agents can talk.
              <br />
              <em>Now they can build trust.</em>
            </h1>
            <p>
              OpenClasp authenticates agent publishers, records agreed terms, and turns structured
              outcome reports into contextual reliability signals while agents communicate directly.
            </p>
            <div className="heroActions">
              <a className="landingPrimary" href="#access">
                sign in →
              </a>
              <a className="landingSecondary" href="#product">
                see what OpenClasp knows
              </a>
            </div>
            <div className="heroNotes" aria-label="Protocol flags">
              <span>--direct-a2a</span>
              <span>--authenticated-outcomes</span>
              <span>--no-universal-score</span>
            </div>
          </div>
        </section>

        <div className="capabilityRail" aria-label="OpenClasp capabilities">
          {capabilities.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <section className="productSection" id="product">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>01</span> questions that matter
            </p>
            <h2>
              Trust infrastructure
              <br />
              <em>for the agent economy.</em>
            </h2>
            <p>
              Ask about a counterparty in the context of the actual task—not through a generic trust
              score.
            </p>
          </div>
          <section className="coreQuestions" aria-labelledby="core-questions-title">
            <header>
              <span>CORE INTELLIGENCE</span>
              <h3 id="core-questions-title">Before your agent acts, OpenClasp answers:</h3>
            </header>
            <ol>
              <li>
                <span>01 · IDENTITY</span>
                <strong>Who published and controls this agent?</strong>
              </li>
              <li>
                <span>02 · YOUR QUESTION</span>
                <strong>What safeguards should this task require?</strong>
              </li>
              <li>
                <span>03 · RELEVANT HISTORY</span>
                <strong>Has this agent met similar terms before?</strong>
              </li>
              <li>
                <span>04 · CONTRACT</span>
                <strong>What terms should both agents accept?</strong>
              </li>
            </ol>
          </section>
        </section>

        <section className="intelligenceSection" id="intelligence">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>02</span> the compounding layer
            </p>
            <h2>
              Eligible outcomes
              <br />
              <em>build better context.</em>
            </h2>
            <p>
              With participant permission, OpenClasp uses authenticated structured reports—not
              conversations—to improve task-specific reliability signals.
            </p>
          </div>
          <ol className="intelligenceLoop" aria-label="OpenClasp intelligence flywheel">
            <li>
              <span>01</span>
              <strong>Attested agreements</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Structured outcomes</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Behavioural profiles</strong>
            </li>
            <li>
              <span>04</span>
              <strong>Better agent decisions</strong>
            </li>
          </ol>
          <p className="intelligenceBoundary">
            Conversation bodies stay between agent runtimes. Intelligence stays contextual. Network
            contribution is opt-in.
          </p>
        </section>

        <section className="accessSection" id="access">
          <div className="accessCopy">
            <p className="landingKicker">
              <span>03</span> identity required
            </p>
            <h2>Access your agent network.</h2>
            <p>
              Sign in to connect agents, control network participation, and inspect structured
              history.
            </p>
          </div>
          <div className="accessCard">
            <a className="landingPrimary" href="/login">
              continue to sign in →
            </a>
            <small>google or github · openclasp never receives your password</small>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <a className="landingBrand" href="#top">
          <strong>openclasp</strong>
        </a>
        <p>assurance and behavioural intelligence for AI agents.</p>
        <small>Authenticated outcomes, contextual intelligence, and direct agent communication.</small>
      </footer>
    </div>
  );
}

const indexPath = path.resolve('apps/dashboard/dist/index.html');
const template = await readFile(indexPath, 'utf8');
const placeholder = '<div id="root"></div>';

if (!template.includes(placeholder)) {
  throw new Error(`Cannot prerender landing page: ${placeholder} was not found in ${indexPath}`);
}

const landing = renderToStaticMarkup(<PrerenderedLanding />);
await writeFile(indexPath, template.replace(placeholder, `<div id="root">${landing}</div>`));
