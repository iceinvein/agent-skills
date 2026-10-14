# Test first

Write one test for the smallest slice of behaviour you intend to add. Run it
and watch it fail before you write anything else. Then write the minimal code
that makes it pass, and watch it pass.

The watching is the point, not a formality. A test you never saw fail might be
broken, aimed at the wrong behaviour, or not running at all; a green result
alone cannot tell you which. A test that passes the first time you run it is
not testing your change, it is testing behaviour that already existed. When
that happens, fix the test, not the code.

**Name the change that would turn it red.** A test is only a test if some
change to the implementation makes it fail, so work out which change before you
write the body, and hold the answer to being one a person would plausibly make
to this code later. An answer nobody would ever write, or one the type checker,
the linter or the framework already rejects on your behalf, means there is no
test to write here. Write nothing and move on. What you were reaching for is an
assertion that stays green whatever you build, and it bills a run on every
commit from now on to keep saying so.

**Some shapes never survive that question.** A getter, a constant, a
framework's own behaviour, a mock's call log. Coverage is a smoke detector,
not a target, and a test added to move the number is the purest case of the
thing this rule refuses.

**Skipping is a judgement, not a list.** Generated or scaffolded code, a config
file with no logic in it, and a prototype headed for the bin are the usual
cases that fail the question outright, but they are instances of the criterion
rather than the whole of it. What you owe in exchange for the judgement is one
sentence in your reply naming the behaviour you left untested and why: a skip
nobody hears about cannot be told apart from an oversight.

**Assertions belong on what the run actually produced**: the value returned,
the state left behind, the output written. Never point one at a mock, because
a green result then proves only that you called the mock the way you meant to,
which you knew already. Before a mock stands in for a dependency, learn what
the real one does on the paths your test never exercises; one that quietly
drops a side effect will hold a broken change green. Where the wiring is what
breaks, one real integration test is worth five mocked unit ones.

**Expected values are written by hand or taken from the spec.** Never produce
one by running the code under test and keeping what came back: a blessed
snapshot checks the implementation against itself, so it stays green whatever
that implementation does, which is the same as having no test at all. The
re-bless is where this goes wrong at scale, the diff too large to read and
every value in it exactly as authoritative as the bug you are freezing.

**One behaviour per test**, named for the behaviour it pins rather than for the
function it calls. Keep helpers that exist only for tests inside the test
files. If a production class grows a method whose only caller is a test
reaching inside it, the test has started reshaping your design.

**A test goes when the behaviour it pinned is gone.** Delete it alongside the
code, in the same commit, like anything else the change orphaned. Two tests
pinning one behaviour are a test and a maintenance bill, so keep the clearer.
None of that reaches a red test. A failure is the suite claiming your change
broke something, and deleting it, skipping it, loosening the assertion or
special-casing the input it feeds answers the claim by silencing the witness.
Believe the test itself is wrong and you say so and get agreement first.

Two friction lines, one in each direction:

"This case is obvious enough to skip straight to the code." A test written
once the code already works can only confirm what you already believe about
it. By that point you have stopped hunting for the cases you never thought of,
so the test does not find them either.

"Better add a test here to be safe." Safe against what? You are one sentence
away from the answer, so finish it and name the change this would catch. If
the sentence will not finish, what moved you was diligence rather than
evidence, and what it buys is a permanently green line nobody later dares
delete.
