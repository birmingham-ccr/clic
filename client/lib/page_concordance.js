"use strict";
/*jslint todo: true, regexp: true, browser: true, unparam: true, plusplus: true, nomen: true */
/*global Promise */
var PageTable = require('./page_table.js');
var DisplayError = require('./alerts.js').prototype.DisplayError;
var concordance_utils = require('./concordance_utils.js');
var quoteattr = require('./quoteattr.js').quoteattr;
var shallow_clone = require('./shallow_clone.js').shallow_clone;
var object_entries = require('object.entries-ponyfill');

// Plural-ise a few known phrases
function plural(amount, unit) {
    if (amount === 1) {
        return amount + " " + unit;
    }

    switch (unit) {
    case "KWIC match":
        return amount + " " + unit + "es";
    default:
        return amount + " " + unit + "s";
    }
}

/* Plot count should link to a URL for just that book */
function renderPlotCount(data, type, full, meta) {
    data = data.length; // Show the count, not all the lines

    if (type === 'display') {
        return '<a title="Click to see lines for this book" target="_blank"' +
               ' onclick="event.stopPropagation();"' +
               ' href="' + full.count_url_prefix + '&corpora=' + encodeURIComponent(full[0]) + '"' +
               '>' + data + '</a>';
    }

    return data;
}


/* Column represents a fractional position in book */
function renderPosition(data, type, full, meta) {
    var xVal, pos_start = full.chapter_start[data[1]] + data[2];

    if (type === 'display') {
        xVal = (pos_start / full.chapter_start._end) * 50; // word in book / total word count

        return '<a class="bookLink" title="Click to display concordance in book"' +
               ' onclick="event.stopPropagation();" target="_blank"' +
               ' href="/chapter?chapter_id=' + data[4] + '&start=' + data[2] + '&end=' + data[3] + '" >' +
               '<svg width="50px" height="15px" xmlns="http://www.w3.org/2000/svg">' +
               '<rect x="0" y="4" width="50" height="7" fill="#D6E1E8"/>' +
               '<line x1="' + xVal + '" x2="' + xVal + '" y1="0" y2="15" stroke="black" stroke-width="2px"/>' +
               '</svg></a>';
    }

    if (type === 'export') {
        return pos_start + '/' + full.chapter_start._end;
    }

    return pos_start;
}


/* Render grouped rows into a set of position plots */
function renderDistributionPlot(data, type, full, meta) {
    function plotDataSvg() {
        var svg_xres = 1000, // The native X resolution of the SVG plot
            min_width = data.length < 1000 ? 5 : 1; // The minimum width of a single line

        return '<svg class="plot min-width-' + min_width + '" viewBox="0 0 ' + svg_xres + ' 40" width="' + svg_xres + '" height="40" preserveAspectRatio="none">' + data.sort(function (a, b) {
            // Sort by #kwicgroups, chapter, position-in-chapter, so kwicgrouped items are on top
            return a.kwic - b.kwic || a[3][1] - b[3][1] || a[3][2] - b[3][2];
        }).map(function (r) {
            var ch_start = r.chapter_start[r[3][1]],  // Word-count at start of chapter
                words_total = r.chapter_start._end,
                posStart = ((ch_start + r[3][2]) / words_total) * svg_xres,
                posWidth = Math.max(min_width, ((r[3][3] - r[3][2]) / words_total) * svg_xres);

            return '<a' +
                ' onclick="event.stopPropagation();" target="_blank"' +
                ' href="/chapter?chapter_id=' + r[3][4] + '&start=' + r[3][2] + '&end=' + r[3][3] + '"' +
                '><rect' +
                ' class="' + r.DT_RowClass + '"' +
                ' x="' + posStart + '"' +
                ' width="' + posWidth + '"' +
                ' y="-5" height="50">' +
                '<title>' +
                    quoteattr(r[0].slice(0, -1).join("")) + '***' +
                    quoteattr(r[1].slice(0, -1).join("")) + '***' +
                    quoteattr(r[2].slice(0, -1).join("")) +
                '</title>' +
                '</rect></a>';
        }).join("\n") + '</svg>';
    }

    function plotDataExcel() {
        return '{' + data.map(function (r) {
            var ch_start = r.chapter_start[r[3][1]],  // Word-count at start of chapter
                words_total = r.chapter_start._end,
                posStart = ((ch_start + r[3][2]) / words_total) * 100;

            return posStart;
        }).join(";") + '}';
    }

    function chapterTicks(first_row) {
        var book_id = first_row[3][0],
            chapter_start = first_row.chapter_start;

        return Object.keys(chapter_start).map(function (ch_num) {
            var pos = (chapter_start[ch_num] / chapter_start._end) * 100;

            if (pos > 99) {
                return "";
            }
            return '<a class="tick chapter"' +
                ' title="Chapter ' + ch_num + '"' +
                ' href="/chapter?book_id=' + book_id + '&chapter_num=' + ch_num + '"' +
                ' style="left: ' + pos + '%"' +
                '></a>';
        }).join("\n");
    }

    if (type === 'display') {
        return '<div class="distribution-plot">' +
            (data[0] ? chapterTicks(data[0]) : '') +
            plotDataSvg() +
            '</div>';
    }

    if (type === 'export') {
        return plotDataExcel();
    }

    // Sorting / filtering is done based on position of first item
    return data.length > 0 ? ((data[0].chapter_start[data[0][3][1]] + data[0][3][3]) / data[0].chapter_start._end) * 100 : null;
}

/* Render full book title, optionally as hover-over - NB: This must be bound to the PageConcordance object to get titles */
function renderBook(render_mode, data, type) {
    if (type === 'display' && this.book_titles[data]) {
        //NB: Edge needs persuasion to get abbr to word-wrap
        return '<abbr style="' +
                'display: block;' +
                (render_mode === 'full' ? 'width: 9.5rem' : '') +
            '" title="' + quoteattr(this.book_titles[data][0] + ' (' + this.book_titles[data][1] + ')') + '">' +
            quoteattr(render_mode === 'full' ? this.book_titles[data][0] : data) + '</abbr>';
    }

    return render_mode === 'full' ? this.book_titles[data][0] : data;
}

// PageConcordance inherits PageTable
function PageConcordance() {
    return PageTable.apply(this, arguments);
}
PageConcordance.prototype = Object.create(PageTable.prototype);

PageConcordance.prototype.init = function () {
    PageTable.prototype.init.apply(this, arguments);

    this.book_titles = {};
    this.table_opts.deferRender = true;
    this.table_opts.autoWidth = false;
    this.table_count_column = 1;
    this.table_opts.orderFixed = { pre: [['0', 'desc']] };
};

PageConcordance.prototype.page_title = function (page_state) {
    return "CLiC concordance search";
};

PageConcordance.prototype.reload = function reload(page_state) {
    var tag_column_order = page_state.state('tag_column_order');

    function renderBoolean(data, type, full, meta) {
        return data ? "✓" : " ";
    }

    // Choose our column list based on the current view
    if (page_state.arg('table-type') === 'dist_plot') {
        this.table_opts.non_tag_columns = [
            { data: "1.max_kwic", defaultContent: "", visible: false, sortable: false, searchable: false },
            { title: "", defaultContent: "", width: "3rem", sortable: false, searchable: false },
            { title: "Book", data: "0", render: renderBook.bind(this, 'full'), width: "10rem", searchable: true },
            { title: "Count", data: "1", width: "3rem", render: renderPlotCount, searchable: false, "orderSequence": [ "desc", "asc" ], },
            { title: '<abbr title="x entries per million words">Rel.Freq</abbr>', data: "rel_freq", width: "3rem", searchable: false, "orderSequence": [ "desc", "asc" ], },
            { title: "Plot", data: "1", render: renderDistributionPlot, searchable: false },
        ];
        if (page_state.arg('kwic-terms').length > 0) {
            this.table_opts.non_tag_columns.splice(4, 0, { title: '<abbr title="# of KWIC matches in book">KWIC</abbr>', data: "1.kwic_count", width: "3rem", searchable: false, "orderSequence": [ "desc", "asc" ], });
        }
        this.table_opts.order = [[3, 'desc']];
    } else {
        this.table_opts.non_tag_columns = [
            { data: "kwic", visible: false, sortable: false, searchable: false },
            { title: "", defaultContent: "", width: "3rem", sortable: false, searchable: false },
            { title: "Left", data: "0", render: concordance_utils.renderTokenArray, class: "context left" }, // Left
            { title: "Node", data: "1", render: concordance_utils.renderTokenArray, class: "context node" }, // Node
            { title: "Right", data: "2", render: concordance_utils.renderTokenArray, class: "context right" }, // Right
            { title: "Book", data: "3.0", render: renderBook.bind(this, 'abbr'), searchable: false }, // Book
            { title: "Ch.", data: "3.1", class: "metadataColumn", searchable: false }, // Chapter
            { title: "Par.", data: "4.0", class: "metadataColumn", searchable: false }, // Paragraph-in-chapter
            { title: "Sent.", data: "4.1", class: "metadataColumn", searchable: false }, // Sentence-in-chapter
            { title: "In&nbsp;bk.", data: "3", width: "52px", render: renderPosition, searchable: false, orderData: [5, 9] }, // Book graph
        ];
        this.table_opts.order = [[9, 'asc']];
    }

    // Generate column list based on tag_columns
    this.table_opts.columns = this.table_opts.non_tag_columns.concat(tag_column_order.map(function (t) {
        return { title: "<div>" + t + "</div>", data: t, width: "2rem", render: renderBoolean, class: "tagColumn" };
    }));
    this.table_el.classList.toggle('hasTagColumns', tag_column_order.length > 0);

    // For single-word nodes, we want to keep the node column narrow to balance the table nicely
    this.table_el.classList.toggle('narrow-node',
        page_state.arg('table-type') !== 'dist_plot' &&
        page_state.arg('conc-q') && /* Subsets won't have conc-q, but will ~always be wide */
        (page_state.arg('conc-type') === 'any' || (page_state.arg('conc-q').match(/\s+/g) || []).length < 6)
        );

    return PageTable.prototype.reload.apply(this, arguments);
};

PageConcordance.prototype.reload_data = function reload(page_state) {
    var kwicTerms = {},
        kwicSpan = [],
        api_opts = {};

    // Values has 2 values, "(min):(max)", which we treat to be
    // min and max span inclusive, viz.
    //      [0]<------------------------->[1]
    // -5 : -4 : -3 : -2 : -1 |  1 :  2 :  3 :  4 :  5
    // L5 : L4 : L3 : L2 : L1 | R1 : R2 : R3 : R4 : R5
    // Output a configuration suitable for testList
    function parseKwicSpan(values) {
        var out = [{ignore: true, reverse: true}, {ignore: true}, {ignore: true}],
            ks = values.split(':');

        if (ks[0] < 0) {
            out[0] = {
                start: -Math.min(ks[1], -1),
                stop: -ks[0],
                reverse: true,
            };
        }

        if (ks[1] >= 0) {
            out[2] = {
                start: Math.max(ks[0], 1),
                stop: ks[1],
            };
        }

        return out;
    }
    kwicSpan = parseKwicSpan(page_state.arg('kwic-span'));

    (page_state.arg('kwic-terms')).map(function (t, i) {
        if (t) {
            kwicTerms[t.toLowerCase()] = i + 1;
        }
    });

    // Mangle page_state into the API's required parameters
    api_opts.corpora = page_state.arg('corpora');
    api_opts.subset = page_state.arg('conc-subset');
    api_opts.q = page_state.arg('conc-q');
    api_opts.contextsize = 10;
    api_opts.metadata = ['book_titles', 'chapter_start'];

    if (api_opts.corpora.length === 0) {
        throw new DisplayError("Please select the corpora to search in", "warn");
    }
    if (!api_opts.q) {
        throw new DisplayError("Please provide some terms to search for", "warn");
    }
    if (!api_opts.subset) {
        throw new DisplayError("Please select a subset", "warn");
    }

    if (page_state.arg('conc-type') === 'any') {
        api_opts.q = api_opts.q.split(/(\s+)/).filter(function (t) {
            return (/\w/).test(t);
        });
    }

    return this.cached_get('concordance', api_opts).then(this.post_process.bind(this, page_state, kwicTerms, kwicSpan));
};

PageConcordance.prototype.post_process = function (page_state, kwicTerms, kwicSpan, raw_data) {
    var i, j, r, groupedData,
        allWords = {}, allMatches = {},
        data = raw_data.data,
        tag_state = page_state.state('tag_columns'),
        tag_column_order = page_state.state('tag_column_order');

    for (i = 0; i < data.length; i++) {
        data[i].DT_RowId = data[i][3][0] + ':' + data[i][3][1] + ':' + data[i][3][2];
        data[i].DT_RowClass = ''; // Make sure we clear any previous RowClass

        // Add KWICGrouper match column
        r = concordance_utils.generateKwicRow(kwicTerms, kwicSpan, data[i], allWords);
        if (r > 0) {
            // Count KWIC matches, and # of unique books
            if (!allMatches[r]) {
                allMatches[r] = [0, {}];
            }
            allMatches[r][0] += 1;
            allMatches[r][1][data[i][3][0]] = 1;

            // Add classes for row highlighting
            data[i].DT_RowClass = 'kwic-highlight-' + (r % 4 + 1);
        }

        // Add tag columns
        for (j = 0; j < tag_column_order.length; j++) {
            data[i][tag_column_order[j]] = !!tag_state[tag_column_order[j]][data[i].DT_RowId];
        }

        // Annotate row with chapter_start object for this book ID
        data[i].chapter_start = raw_data.chapter_start[data[i][3][0]];
    }

    // Save book_titles ready for the renderer function
    this.book_titles = raw_data.book_titles || {};

    // Group data into books for concordance plot
    if (page_state.arg('table-type') === 'dist_plot') {
        groupedData = {};
        for (i = 0; i < data.length; i++) {
            j = data[i][3][0]; // The book name
            if (groupedData.hasOwnProperty(j)) {
                groupedData[j].push(data[i]);
            } else {
                groupedData[j] = [data[i]];
                groupedData[j].max_kwic = 0;
                groupedData[j].kwic_count = 0;
            }
            if (data[i].kwic > groupedData[j].max_kwic) {
                groupedData[j].max_kwic = data[i].kwic;
            }
            groupedData[j].kwic_count += data[i].kwic > 0 ? 1 : 0;
        }
        // Turn dict of book => rows into array of [book, rows]
        raw_data = {
            version: raw_data.version, // TODO: Proper shallow copy? NB: We need to do this otherwise cached_get's copy gets modified
            data: object_entries(groupedData),
        };

        r = page_state.clone({args: { 'table-type': 'basic', corpora: [] }}).to_url();
        for (i = 0; i < raw_data.data.length; i++) {
            // Use book IDs as row IDs
            raw_data.data[i].DT_RowId = raw_data.data[i][0];

            // Add tag columns
            for (j = 0; j < tag_column_order.length; j++) {
                raw_data.data[i][tag_column_order[j]] = !!tag_state[tag_column_order[j]][raw_data.data[i].DT_RowId];
            }

            // Add count URL prefix for use in the render function
            raw_data.data[i].count_url_prefix = r;

            // (# of lines) / (words in book) * (1 million)
            raw_data.data[i].rel_freq = ((raw_data.data[i][1].length / raw_data.data[i][1][0].chapter_start._end) * 1000000).toFixed(2);
        }
    }

    // Update extra strings for dataTables.net info line
    this.extra_info = [];

    // Show how many books mentioned if not a dist_plot (otherwise it's pointless)
    if (page_state.arg('table-type') !== 'dist_plot') {
        this.extra_info.push("from " + plural(Object.keys(raw_data.chapter_start).length, "book"));
    }

    // Add KWIC summary
    Object.keys(allMatches).sort(function (a, b) { return b - a; }).map(function (count) {
        this.extra_info.push(
            plural(allMatches[count][0], "line") + " / " +
                plural(Object.keys(allMatches[count][1]).length, "book") + " with " +
                plural(parseInt(count, 10), "KWIC match")
        );
    }.bind(this));

    // Add allWords to server response
    raw_data.allWords = allWords;
    return raw_data;
};

module.exports = PageConcordance;
