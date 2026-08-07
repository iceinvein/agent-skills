# Test first

Write one test for the smallest slice of behaviour you intend to add. Run it
and watch it fail before you write anything else. Then write the minimal code
that makes it pass, and watch it pass.

The watching is the point, not a formality. A test you never saw fail might be
broken, aimed at the wrong behaviour, or not running at all; a green result
alone cannot tell you which. A test that passes the first time you run it is
not testing your change, it is testing behaviour that already existed. When
that happens, fix the test, not the code.

A test is only a test if some change to the implementation would turn it red.
Work out which change before you write the body; if there isn't one, what you
have is an assertion that stays green whatever you build.

Assertions belong on what the run actually produced: the value returned, the
state left behind, the output written. Never point one at a mock: a green
result then proves only that you called the mock the way you meant to, which
you knew already. Before a mock stands in for a dependency, learn what the real
one does on the paths your test never exercises; one that quietly drops a side
effect will hold a broken change green.

Keep helpers that exist only for tests inside the test files. If a production
class grows a method whose only caller is a test reaching inside it, the test
has started reshaping your design.

Three cases are worth asking to skip: generated or scaffolded code, a config
file with no logic in it, and a prototype headed for the bin before anyone
sees it. Ask rather than assume, and treat that list as closed.

The friction line: "this case is obvious enough to skip straight to the
code." A test written once the code already works can only confirm what you
already believe about it. By that point you have stopped hunting for the cases
you never thought of, so the test does not find them either.
