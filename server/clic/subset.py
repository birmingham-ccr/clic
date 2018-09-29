# -*- coding: utf-8 -*-
"""Subset endpoint

Returns subsets of given texts, for example quotations.

- corpora: 1+ corpus name (e.g. 'dickens') or book name ('AgnesG') to search within
- subset: subset to return, one of shortsus/longsus/nonquote/quote/all. Default 'all' (i.e. all text)
- contextsize: Size of context window around subset. Default 0.
- metadata: Optional data to return, see get_book_metadata in clicdb.py for all options

Parameters should be provided in querystring format, for example::

    ?corpora=dickens&corpora=AgnesG&subset=quote

Returns a ``data`` array, one entry per result. The data array is sorted by the book id,
then chapter number. Each item is an array with the following items:

* The left context window (if ``contextsize`` > 0, otherwise omitted)
* The node (i.e. the subset)
* The right context window (if ``contextsize`` > 0, otherwise omitted)
* Result metadata
* Position-in-book metadata

Each of left/node/right context window is an array of word/non-word tokens, with the final item
indicating which of the tokens are word tokens. For example::

    [
        'while',
        ' ',
        'this',
        ' ',
        'shower',
        ' ',
        'gets',
        ' ',
        'owered',
        ",'",
        ' ',
        [0, 2, 4, 6, 8],
    ]

Result metadata and Position-in-book metadata are currently subject to change.

The ``version`` object gives both the current version of CLiC and the revision of the
corpora ingested in the database.

Examples:

/api/subset?corpora=AgnesG&subset=longsus::

    {"data":[
      [["observed"," ","Smith",";"," ","'","and"," ","a"," ","darksome"," ",[0,2,6,8,10]], . . .],
      [["replied"," ","she",","," ","with"," ","a"," ","short",","," ","bitter"," ","laugh",";"," ",[0,2,5,7,9,12,14]], . . .],
       . . .
    ], "version":{"corpora":"master:fc4de7c", "clic":"1.6:95bf699"}}

/api/subset?corpora=AgnesG&subset=longsus&contextsize=3::

    {"data":[
      [
        ["you",","," ","Miss"," ","Agnes",",'"," ",[0,3,5]],
        ["observed"," ","Smith",";"," ","'","and"," ","a"," ","darksome"," ",[0,2,6,8,10]],
        ["'","un"," ","too",";"," ","but",[1,3,6]],
         . . .
      ], [
        ["shown"," ","much"," ","mercy",",'"," ",[0,2,4]],
        ["replied"," ","she",","," ","with"," ","a"," ","short",","," ","bitter"," ","laugh",";"," ",[0,2,5,7,9,12,14]],
        ["'","killing"," ","the"," ","poor",[1,3,5]],
         . . .
      ],
    ], "version":{"corpora":"master:fc4de7c", "clic":"1.6:95bf699"}}

"""
from clic.concordance import to_conc

from clic.db.book import get_book_metadata, get_book
from clic.db.corpora import corpora_to_book_ids
from clic.db.lookup import api_subset_lookup
from clic.errors import UserError


def subset(cur, corpora=['dickens'], subset=['all'], contextsize=['0'], metadata=[]):
    """
    Main entry function for subset search

    - corpora: List of corpora / book names
    - subset: Subset(s) to search for.
    - contextsize: Size of context window, defaults to none.
    - metadata, Array of extra metadata to provide with result, some of
      - 'book_titles' (return dict of book IDs to titles at end of result)
    """
    book_ids = corpora_to_book_ids(cur, corpora)
    if len(book_ids) == 0:
        raise UserError("No books to search", "error")
    contextsize = contextsize[0]
    metadata = set(metadata)
    book_cur = cur.connection.cursor()
    book = None
    api_subset = api_subset_lookup(cur)
    rclass_ids = tuple(api_subset[s] for s in subset)

    # TODO: Use whatever filtering by region we do to speed this up also
    cur.execute("""
        SELECT r.book_id
             , ARRAY(SELECT tokens_in_crange(r.book_id, range_expand(r.crange, %(contextsize)s))) full_tokens
             , ARRAY_AGG(t.crange ORDER BY ordering) node_tokens
             , MIN(t.ordering) word_id_min
             , MAX(t.ordering) word_id_max
          FROM region r, token t
         WHERE t.book_id = r.book_id AND t.crange <@ r.crange
           AND r.book_id IN %(book_id)s
           AND r.rclass_id IN %(rclass_ids)s
      GROUP BY r.book_id, r.crange
    """, dict(
        book_id=tuple(book_ids),
        contextsize=int(contextsize) * 10,  # TODO: Bodge word -> char
        rclass_ids=rclass_ids,
    ))

    for book_id, full_tokens, node_tokens, word_id_min, word_id_max in cur:
        if not book or book['id'] != book_id:
            book = get_book(book_cur, book_id, content=True)
        conc_left, conc_node, conc_right = to_conc(book['content'], full_tokens, node_tokens)
        yield [
            conc_left,
            conc_node,
            conc_right,
            # TODO: What to do about chapter_num?
            [book['name'], 0, word_id_min, word_id_max],
            # TODO: Para / sentence counts (and probably move chap counts here)
            [0, 0]
        ]

    book_cur.close()

    footer = get_book_metadata(cur, book_ids, metadata)
    if footer:
        yield ('footer', footer)
