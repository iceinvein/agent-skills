# Test first

Write one test for the smallest slice of behaviour you are about to add. Run
it and watch it fail before you write anything else. Then write the minimal
code that makes it pass, and watch it pass.

The watching is the point, not a formality. A test you never saw fail might
be broken, testing the wrong thing, or not running at all; a green result
alone cannot tell you which. A test that passes the first time you run it is
not testing your change, it is testing behaviour that already existed. When
that happens, fix the test, not the code.

Before you write a test, name the production change that would make it
fail. If you cannot name one, you do not have a test yet, you have an
assertion that will pass no matter what you build.

Assert on real behaviour: the actual return value, state, or output. Never
assert on what a mock recorded; a mock only proves you called it the way you
expected to call it. Before you mock a dependency, know what it actually
does on the paths you are not exercising directly. A mock that skips a real
side effect turns a broken change into a green test.

Keep helpers that exist only for tests inside the test files. If a
production class grows a method whose only caller is a test reaching
inside it, the test has started reshaping your design.

Ask before skipping this rule for code you did not hand-write (generated
or scaffolded), a config file with no logic in it, or a prototype headed
for the trash before anyone sees it. These are exceptions, not a general
escape.

The friction line: "this case is obvious enough to skip straight to the
code." A test written once the code already works confirms what you
already believe about it; a test written now won't find the cases you
never thought of, because you've stopped looking for them.
