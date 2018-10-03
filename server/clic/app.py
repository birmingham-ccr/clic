from flask import Flask, request, Response, jsonify
from flask_cors import CORS

import clic.concordance
import clic.cluster
import clic.count
import clic.metadata
import clic.keyword
import clic.subset
from clic.db.cursor import get_pool_cursor
from clic.db.version import clic_version
from clic.stream_json import stream_json, format_error, JSONEncoder


STREAMING_APIS = [
    clic.cluster.cluster,
    clic.concordance.concordance,
    clic.count.count,
    clic.keyword.keyword,
    clic.subset.subset,
]


def streaming_view_func(fn):
    def view_func():
        with get_pool_cursor() as cur:
            header = dict(version=clic_version(cur))
            out = fn(cur, **request.args)
            return Response(
                stream_json(out, header, cls=JSONEncoder),
                content_type='application/json',
            )
    return view_func


JSON_APIS = [
    clic.metadata.corpora,
    clic.metadata.corpora_headlines,
]


def json_view_func(fn):
    def view_func():
        with get_pool_cursor() as cur:
            out = fn(cur)
            out['version'] = clic_version(cur)
            return jsonify(out)
    return view_func


def create_app(config=None, app_name=None):
    app = Flask(__name__)
    app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
    app.json_encoder = JSONEncoder

    # Register a view for all regular API calls
    for fn in STREAMING_APIS:
        app.add_url_rule(
            '/api/' + fn.__name__.replace('_', '/'),
            endpoint=fn.__name__,
            methods=['GET'],
            view_func=streaming_view_func(fn),
        )

    # Metadata routes are just passed through jsonify
    for fn in JSON_APIS:
        app.add_url_rule(
            '/api/' + fn.__name__.replace('_', '/'),
            endpoint=fn.__name__,
            methods=['GET'],
            view_func=json_view_func(fn),
        )

    # Extensions
    CORS(app)

    # Enable profiling per request
    # from werkzeug.contrib.profiler import ProfilerMiddleware
    # app.wsgi_app = ProfilerMiddleware(app.wsgi_app)

    @app.after_request
    def add_header(response):
        # Everything can be cached for up to an hour
        response.cache_control.max_age = 3600
        response.cache_control.public = True
        return response

    @app.errorhandler(404)
    def handle_404(error):
        response = jsonify(dict(error=dict(
            message="This endpoint does not exist",
        )))
        response.status_code = 404
        return response

    @app.errorhandler(500)
    def handle_500(error):
        response = jsonify(format_error(error))
        response.status_code = 500
        return response

    return app