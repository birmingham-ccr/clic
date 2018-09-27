import json


def format_error(e):
    import traceback

    level = getattr(e, 'level', 'error')
    print_stack = getattr(e, 'print_stack', True)
    return {level: dict(
        message=(e.__class__.__name__ + ": " if print_stack else "") + str(e),
        stack=traceback.format_exc() if print_stack else None,
    )}


def stream_json(generator, header={}):
    """
    Stream output of generator as JSON. Generator results should be of the
    form:

    - ('footer', {x}): Include items in x after main results
    - ('header', {x}): Include items in x before main results
    - Anything else: Add to a "data" array
    """
    def format_header(header):
        header = json.dumps(header, separators=(',', ':'), sort_keys=True)

        if header[-1] != '}':
            raise ValueError("Initial item not a JSON object: %s" % header)
        if header == '{}':
            return '{"data":['
        return header[:-1] + ',"data":['

    footer = {}
    header_written = False
    try:
        for x in generator:
            if isinstance(x, tuple) and x[0] == 'footer':
                footer.update(x[1])
            elif isinstance(x, tuple) and x[0] == 'header':
                header.update(x[1])
            else:
                if header_written:
                    yield ',\n' + json.dumps(x, separators=(',', ':'))
                else:
                    yield format_header(header)
                    yield '\n' + json.dumps(x, separators=(',', ':'))
                    header_written = True
    except Exception as e:
        footer.update(format_error(e))

    if not header_written:
        yield format_header(header)

    if len(footer) > 0:
        # End list and format footer
        yield '\n], ' + json.dumps(
            footer,
            separators=(',', ':'),
            sort_keys=True
        )[1:]
    else:
        yield '\n]}'
