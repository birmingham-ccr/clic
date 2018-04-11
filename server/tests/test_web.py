import json
import unittest

import clic.web
from clic.errors import UserError

class Test_stream_json(unittest.TestCase):
    def sj(self, gen, header={}):
        out = "\r".join(clic.web.stream_json(gen, header))
        json.loads(out) # Parse to validate
        return out

    def test_header(self):
        """The header has to be an object"""
        def fn():
            yield 1
            yield 2
            yield 3
        with self.assertRaisesRegexp(ValueError, '"poot"'):
            self.sj(fn(), "poot")

    def test_allempty(self):
        """Returning no values results in an empty array"""
        def fn():
            return iter(())
        self.assertEqual(self.sj(fn()), '{"data":[\r\n]}')

    def test_headerandempty(self):
        """Just a header works"""
        def fn():
            return iter(())
        self.assertEqual(self.sj(fn(), {"moo": "yes"}), '{"moo":"yes","data":[\r\n]}')

    def test_emptyheader(self):
        """An empty header doesn't trip us up"""
        def fn():
            yield 1
            yield 2
            yield 3
        self.assertEqual(self.sj(fn(), {}), '{"data":[\r\n1\r,\n2\r,\n3\r\n]}')

    def test_headerresults(self):
        """All header items come before the results"""
        def fn():
            yield 1
            yield 2
            yield 3
        self.assertEqual(self.sj(fn(), {"a":1,"b":2}), '{"a":1,"b":2,"data":[\r\n1\r,\n2\r,\n3\r\n]}')

    def test_initialerror(self):
        """Initial errors are caught"""
        def fn():
            raise ValueError("Erk")
            yield 1
            yield 2
            yield 3

        out = json.loads(self.sj(fn(), {"a":1,"b":2}))
        self.assertEqual(out['data'], [])
        self.assertEqual(out['error'], dict(
            message="ValueError: Erk",
            stack=out['error']['stack'],
        ))
        self.assertIn("ValueError: Erk", out['error']['stack'])

    def test_intermediateerror(self):
        """Intermediate errors are caught"""
        def fn():
            yield 1
            yield 2
            raise ValueError("Erk")
            yield 3

        out = json.loads(self.sj(fn(), {"a":1,"b":2}))
        self.assertEqual(out['data'], [1,2])  # NB: Got some of the data
        self.assertEqual(out['error'], dict(
            message="ValueError: Erk",
            stack=out['error']['stack'],
        ))
        self.assertIn("ValueError: Erk", out['error']['stack'])

    def test_usererror(self):
        """User errors can prettify the error message"""
        def fn():
            yield 1
            yield 2
            raise UserError("Potato!", "info")

        out = json.loads(self.sj(fn(), {"a":1,"b":2}))
        self.assertEqual(out['data'], [1,2])
        self.assertEqual(out['info'], dict(
            message="Potato!",
            stack=None,
        ))

    def test_footer(self):
        """We can return custom footer data"""
        def fn(max_data):
            for x in range(max_data):
                yield x
            yield ('footer', dict(bottom='yes'))

        out = json.loads(self.sj(fn(2), {"a":1,"b":2}))
        self.assertEqual(out, dict(
            a=1,
            b=2,
            bottom='yes',
            data=[0, 1],
        ))

        out = json.loads(self.sj(fn(1), {"a":1,"b":2}))
        self.assertEqual(out, dict(
            a=1,
            b=2,
            bottom='yes',
            data=[0],
        ))

        out = json.loads(self.sj(fn(0), {"a":1,"b":2}))
        self.assertEqual(out, dict(
            a=1,
            b=2,
            bottom='yes',
            data=[],
        ))
