"use strict";
/*jslint todo: true, regexp: true, browser: true, unparam: true, plusplus: true */
/*global Promise */
var jQuery = require('jquery/dist/jquery.slim.js');
var noUiSlider = require('nouislider');
global.jQuery = jQuery;  // So chosen-js can find it
var chosen = require('chosen-js');
var api = require('./api.js');
var TagToggle = require('./tagtoggle.js');

var noUiSlider_opts = {
    'kwic-span': {
        start: [-5, 5],
        range: {min: -5, "10%": -4, "20%": -3, "30%": -2, "40%": -1,
                "60%":  1, "70%":  2, "80%":  3, "90%":  4, max:  5},
        snap: true,
        pips: {
            mode: 'steps',
            density: 10,
            filter: function (v, t) { return v === 0 ? 1 : 2; },
            format: { to: function (v) { return (v > 0 ? 'R' : v < 0 ? 'L' : '') + Math.abs(v); } },
        },
        format: {
            to: function (value) { return value; },
            from: function (value) { return value.replace('L', '-').replace('R', ''); },
        },
        connect: true
    },
};

var state_defaults = {
    'corpora': [],
    'conc-subset': 'all',
    'conc-q': '',
    'conc-type': 'whole',
    'subset-subset': 'shortsus',
    'table-filter': '',
    'table-metadata': '',
    'kwic-span': '-5:5',
    'kwic-terms': [],
};

function to_options_html(opts, group_label) {
    var out;

    function escapeHtml(s) {
        // https://bugs.jquery.com/ticket/11773
        return (String(s)
            .replace(/&(?!\w+;)/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')); // "
    }

    out = opts.map(function (t) {
        if (t.id && t.title) {
            return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.title) + "</option>";
        }
        return "<option>" + escapeHtml(t) + "</option>";
    }).join("");

    if (group_label) {
        out = '<optgroup label="' + escapeHtml(group_label) + '">' + out + '</optgroup>';
    }
    return out;
}

function ControlBar(control_bar) {
    var self = this;

    this.control_bar = control_bar;

    control_bar.addEventListener('click', function (e) {
        function clickedOn(tagName, className) {
            var el = e.target;

            while (el.parentElement) {
                if (tagName && el.tagName === tagName) {
                    return true;
                }
                if (className && el.classList.contains(className)) {
                    return true;
                }
                el = el.parentElement;
            }
            return false;
        }

        if (clickedOn('LEGEND', null)) {
            e.preventDefault();
            e.stopPropagation();

            self.page_state.new({
                doc: e.target.href,
                args: {},
                state: {},
            }, 'push');
            return;
        }

        if (clickedOn(null, 'handle')) {
            control_bar.classList.toggle('in');
            return;
        }
    });

    control_bar.addEventListener('change', function (e) {
        if (this.change_timeout) {
            window.clearTimeout(this.change_timeout);
        }
        this.change_timeout = window.setTimeout(function () {
            var new_search = {};

            jQuery(control_bar).serializeArray().forEach(function (f) {
                if (Array.isArray(new_search[f.name])) {
                    new_search[f.name].push(f.value);
                } else if (new_search.hasOwnProperty(f.name)) {
                    new_search[f.name] = [new_search[f.name], f.value];
                } else {
                    new_search[f.name] = [f.value];
                }
            });

            // Unchecked checkboxes should be false
            Array.prototype.forEach.call(control_bar.querySelectorAll('fieldset:not([disabled]) input[type=checkbox]:not(:checked)'), function (el, i) {
                new_search[el.name] = [""];
            });

            self.page_state.update({args: new_search});
        }, 300);
    });

    if (window.screen.availWidth > 960) {
        this.control_bar.classList.add('in');
    }

    Array.prototype.forEach.call(this.control_bar.querySelectorAll('.chosen-select'), function (el, i) {
        jQuery(el).chosen().change(function (e) {
            // Chosen's change event isn't bubbling to the form, do it ourselves.
            control_bar.dispatchEvent(new window.Event('change', {"bubbles": true}));
        });
    });

    // Turn "nouislider"-type inputs into an actual nouislider
    Array.prototype.forEach.call(this.control_bar.querySelectorAll('input[type=nouislider]'), function (el, i) {
        var slider_div = document.createElement('DIV');

        el.style.display = 'none';
        el.parentNode.insertBefore(slider_div, el);

        noUiSlider.create(slider_div, noUiSlider_opts[el.name]);

        el.addEventListener('change', function (e) {
            if (this.value !== slider_div.noUiSlider.get().join(':')) {
                slider_div.noUiSlider.set(this.value.split(':'));
            }
        });

        slider_div.noUiSlider.on('update', function (values) {
            if (!el.value) {
                // Initial update, don't trigger anything
                el.value = values.join(':');
            } else if (el.value !== values.join(':')) {
                el.value = values.join(':');
                el.dispatchEvent(new window.Event('change', {"bubbles": true}));
            }
        });
    });
}

// Refresh controls based on page_state
ControlBar.prototype.reload = function reload(page_state) {
    var self = this;

    self.page_state = page_state; // Store this for events

    return api.get('corpora').then(function (corpora) {
        var tag_toggles_el;

        // Enable the fieldset for the page
        Array.prototype.forEach.call(self.control_bar.elements, function (el, i) {
            if (el.tagName === 'FIELDSET') {
                el.disabled = ('/' + el.name !== page_state.doc());
            }
        });

        // TODO: Hard-code the tag state for now
        if (!page_state.state('tag_columns')) {
            page_state.update({ state: { tag_columns: {
                'Pablo-BP-CONC': {}, //TODO: Hardcoding for now
                'MB-BP-CONC': {},
            }}}, 'silent');
        }

        // Recreate tag toggles
        tag_toggles_el = self.control_bar.querySelectorAll('fieldset:not([disabled]) .tag-toggles')[0];
        if (tag_toggles_el) {
            tag_toggles_el.innerHTML = '';
            self.tag_toggles = Object.keys(page_state.state('tag_columns', {})).map(function (t) {
                var toggle = new TagToggle(t);

                toggle.onupdate = function (tag_state) {
                    var i, new_columns = JSON.parse(JSON.stringify(page_state.state('tag_columns', {})));

                    for (i = 0; i < self.table_selection.length; i++) {
                        if (tag_state === 'yes') {
                            new_columns[t][self.table_selection[i].DT_RowId] = true;
                        } else {
                            delete new_columns[t][self.table_selection[i].DT_RowId];
                        }
                    }

                    page_state.update({ state: { tag_columns: new_columns }});
                };

                tag_toggles_el.appendChild(toggle.dom());
                return toggle;
            });
        }

        // Make sure we consider existing options valid
        self.control_bar.elements['kwic-terms'].innerHTML = to_options_html(page_state.arg('kwic-terms', []));

        // Populate corpora dropdowns
        Array.prototype.forEach.call(self.control_bar.querySelectorAll('select[name=corpora]'), function (el) {
            el.innerHTML = to_options_html(corpora.corpora, 'Entire corpora') + corpora.corpora.map(function (c) {
                return to_options_html(c.children, c.title);
            }).join("");
            jQuery(el).val(page_state.arg('corpora', []));
        });

        // Set values from page options, or defaults
        Array.prototype.forEach.call(self.control_bar.elements, function (el) {
            if (el.tagName === 'FIELDSET' || !state_defaults.hasOwnProperty(el.name)) {
                Math.floor(0);
            } else if (el.tagName === 'INPUT' && el.type === "checkbox") {
                el.checked = !!page_state.arg(el.name, state_defaults[el.name]);
            } else if (el.tagName === 'SELECT') {
                jQuery(el).val(page_state.arg(el.name, state_defaults[el.name]));
            } else {
                el.value = page_state.arg(el.name, state_defaults[el.name]);
            }
        });

        // Tell all the chosen's that values are altered
        Array.prototype.forEach.call(self.control_bar.querySelectorAll('.chosen-select'), function (el, i) {
            jQuery(el).trigger("chosen:updated");
        });
    });
};

// Apply results of any search into data
ControlBar.prototype.new_data = function new_data(data) {
    var prevVal, el;

    if (data.allWords) {
        // Make sure values already selected stay selectable
        el = this.control_bar.elements['kwic-terms'];
        prevVal = jQuery(el).val() || [];
        prevVal.map(function (t, i) {
            data.allWords[t] = true;
        });

        el.innerHTML = to_options_html(Object.keys(data.allWords));
        el.value = prevVal;
        jQuery(el).trigger("chosen:updated");
    }

    this.control_bar.querySelectorAll("#kwic-total-matches")[0].innerText = (data.totalMatches || 0);
};

// New rows selected, process selection-based widgets
ControlBar.prototype.new_selection = function new_selection(data) {
    this.table_selection = data;

    // All toggles update themselves
    this.tag_toggles.forEach(function (toggle) {
        toggle.update(data);
    });
};

module.exports = ControlBar;
