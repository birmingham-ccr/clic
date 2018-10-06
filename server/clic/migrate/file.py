import json


def from_book_file(f):
    """
    Parse a file-handle into book format
    """
    book = dict()
    for line in f:
        if 'content' in book:
            # Started content, append to it
            book['content'] += line
        elif line == "\n":
            # Reached separator, switch to content mode
            book['content'] = ""
        elif 'name' not in book:
            # First line is metadata line
            book.update(json.loads(line))
            book['regions'] = []
        else:
            # Region line
            book['regions'].append(json.loads(line))
    return book


def to_book_file(book, f):
    """
    Write (book) out to file-handle (f)
    """
    # Initial metadata
    json.dump(dict(
        name=book['name'],
    ), f)
    f.write("\n")

    # Regions
    for r in book['regions']:
        json.dump(r, f)
        f.write("\n")

    # Contents
    f.write("\n")
    f.write(book['content'])


def script_export_book_file():
    import sys
    from clic.db.book import get_book
    from clic.db.cursor import get_script_cursor

    book_name = sys.argv[1]
    if (len(sys.argv) > 2):
        f = open(sys.argv[2], 'w')
    else:
        f = sys.stdout

    with get_script_cursor(for_write=False) as cur:
        book = get_book(cur, book_name, content=True, regions=True)
        to_book_file(book, f)
