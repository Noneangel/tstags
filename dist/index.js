"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var docopt = require("docopt");
var glob = require("glob");
var _ = require("lodash");
var ts = require("typescript");
var pkg = require('../package.json');
var USAGE = pkg.name + " v" + pkg.version + "\n\nUsage: tstags [options] [FILE]...\n\nOptions:\n  -h, --help          show this help message and exit\n  -v, --version       show version and exit\n  -f, --file [-]      write output to specified file. If file is \"-\", output is written to standard out\n  -R, --recursive     recurse into directories in the file list [default: false]\n  --fields <fields>   include selected extension fields\n  --list-kinds        list supported languages\n  --sort              sort tags [default: false]\n  --target <version>  targeting language version [default: ES6]\n  --tag-relative      file paths should be relative to the directory containing the tag file [default: false]\n";
var fields = {};
fields[ts.SyntaxKind.MethodDeclaration] = ['f', 'function'];
fields[ts.SyntaxKind.Constructor] = ['o', 'constructor'];
fields[ts.SyntaxKind.PropertyDeclaration] = ['m', 'member'];
fields[ts.SyntaxKind.GetAccessor] = ['m', 'member'];
fields[ts.SyntaxKind.SetAccessor] = ['m', 'member'];
fields[ts.SyntaxKind.VariableDeclaration] = ['v', 'variable'];
fields[ts.SyntaxKind.FunctionDeclaration] = ['f', 'function'];
fields[ts.SyntaxKind.FunctionExpression] = ['f', 'function'];
fields[ts.SyntaxKind.ClassDeclaration] = ['c', 'class'];
fields[ts.SyntaxKind.ClassExpression] = ['c', 'class'];
fields[ts.SyntaxKind.InterfaceDeclaration] = ['i', 'interface'];
fields[ts.SyntaxKind.TypeAliasDeclaration] = ['t', 'typealias'];
fields[ts.SyntaxKind.EnumDeclaration] = ['e', 'enum'];
fields[ts.SyntaxKind.ModuleDeclaration] = ['M', 'module'];
var kinds = _.uniq(_.map(_.values(fields), function (value) { return value.join('  '); }));
var scriptTargets = {
    ES3: ts.ScriptTarget.ES3,
    ES5: ts.ScriptTarget.ES5,
    ES6: ts.ScriptTarget.ES2015,
    Latest: ts.ScriptTarget.Latest,
};
var Tags = /** @class */ (function () {
    function Tags(options) {
        options = options || {};
        this.sort = options.sort || false;
        this.entries = [];
    }
    Tags.prototype.headers = function () {
        var sorted = this.sort ? '1' : '0';
        return [
            { header: '_TAG_FILE_FORMAT', value: '2', help: 'extended format; --format=1 will not append ;" to lines' },
            { header: '_TAG_FILE_SORTED', value: sorted, help: '0=unsorted, 1=sorted, 2=foldcase' },
            { header: '_TAG_PROGRAM_AUTHOR', value: 'Pierre Macherel', help: 'no.way@gmail.com' },
            { header: '_TAG_PROGRAM_NAME', value: 'tstags' },
            { header: '_TAG_PROGRAM_URL', value: 'https://github.com/Perlence/tstags' },
            { header: '_TAG_PROGRAM_VERSION', value: '0.3' },
        ];
    };
    Tags.prototype.toString = function () {
        return this.writeHeaders().concat(this.writeEntries()).join('\n');
    };
    Tags.prototype.writeHeaders = function () {
        return this.headers().map(function (header) {
            return "!" + header.header + "\t" + header.value + "\t" + (header.help || '');
        });
    };
    Tags.prototype.writeEntries = function () {
        var sorted = this.entries;
        if (this.sort)
            sorted = _.sortBy(this.entries, 'name');
        return sorted.map(function (entry) {
            return entry.name + "\t" + entry.file + "\t" + entry.address + ";\"\t" + entry.field + "\tline:" + entry.line +
                (entry.extraField !== undefined ? "\t" + entry.extraField.map(function (parent) { return parent.type + ":" + parent.name; }).join("\t") : "");
        });
    };
    return Tags;
}());
function main() {
    var args = docopt.docopt(USAGE, { version: pkg.version });
    if (args['--version']) {
        console.log(pkg.version);
        process.exit(0);
    }
    if (args['--list-kinds']) {
        console.log(kinds.join('\n'));
        process.exit(0);
    }
    // List of files must be given.
    if (!args['FILE'].length) {
        console.log(USAGE);
        process.exit(1);
    }
    var names = args['FILE'];
    var filenames;
    if (args['--recursive']) {
        // Get all *.ts files recursively in given directories.
        filenames = _(names)
            .map(function (dir) { return glob.sync(path.join(dir, '**', '*.ts')); })
            .flatten()
            .value();
    }
    else {
        filenames = names;
    }
    var languageVersion = scriptTargets[args['--target']];
    if (languageVersion == null) {
        console.error('Unsupported language version: ' + args['--target']);
        process.exit(1);
    }
    var tags = new Tags({ sort: args['--sort'] });
    filenames.forEach(function (filename) {
        var text = fs.readFileSync(filename);
        var source = ts.createSourceFile(filename, text.toString(), languageVersion, false);
        makeTags(tags, source, {
            languageVersion: languageVersion,
            fields: args['--fields'],
            tagRelative: args['--tag-relative'],
        });
    });
    if (!tags.entries.length)
        process.exit(0);
    if (args['--file'] === '-') {
        console.log(tags.toString());
    }
    else {
        var filename = args['--file'] || 'tags';
        fs.writeFileSync(filename, tags.toString());
    }
}
exports.main = main;
var Field = /** @class */ (function () {
    function Field(name, type) {
        this.name = name;
        this.type = type;
    }
    return Field;
}());
function makeTags(tags, source, options) {
    var lines = splitLines(source.text);
    var scopeStack = [];
    var expressionCounter = {
        func: 1,
        class: 1
    };
    makeTag(source);
    /** dept 1 */
    function getIdentifierName(node) {
        var res = [];
        function aux(node) {
            switch (node.kind) {
                case ts.SyntaxKind.Identifier:
                    res.push(node.getText(source));
                    break;
            }
        }
        ts.forEachChild(node, function (child) { return aux(child); });
        if (res.length > 1)
            throw Error("multiple identifier found for node " + JSON.stringify(node));
        if (res.length) {
            return res[0];
        }
        var name = "";
        switch (node.kind) {
            case ts.SyntaxKind.Constructor:
                name = "constructor";
                break;
            case ts.SyntaxKind.FunctionExpression:
                name = "function"; // + expressionCounter.func++;
                break;
            case ts.SyntaxKind.ClassExpression:
                name = "class"; // + expressionCounter.class++;
                break;
        }
        return name || "anonymous";
    }
    /** dept 1 */
    function getIdentifierPos(node) {
        function getStartOrPos(node) {
            try {
                return node.getStart(source);
            }
            catch (_a) {
                return node.pos;
            }
        }
        function aux(node) {
            switch (node.kind) {
                case ts.SyntaxKind.Identifier:
                    res.push(getStartOrPos(node));
                    break;
            }
        }
        var res = [];
        ts.forEachChild(node, function (child) { return aux(child); });
        if (res.length > 1)
            throw Error("multiple identifier found for node " + JSON.stringify(node));
        return res.length ? res[0] : getStartOrPos(node); // identifier or node position
    }
    function makeTag(node) {
        // return true if a field was pushed on scopeStack
        function aux(field, node, entry) {
            if (field != null && (options.fields == null || options.fields.indexOf(field[0]) >= 0)) {
                entry.name = getIdentifierName(node);
                entry.field = field[0];
                entry.file = options.tagRelative == true ?
                    source.fileName :
                    path.resolve(source.fileName);
                var firstLine = extractLine(getIdentifierPos(node));
                entry.address = "/^" + firstLine.text + "$/";
                entry.line = firstLine.line;
                if (scopeStack.length) {
                    if (!entry.extraField) {
                        entry.extraField = [];
                    }
                    entry.extraField.push(scopeStack[scopeStack.length - 1]);
                }
                scopeStack.push(new Field(entry.name, field[1]));
                tags.entries.push(entry);
                return true;
            }
            return false;
        }
        var entry = {};
        var popStack = false;
        var recurs = true;
        switch (node.kind) {
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.FunctionDeclaration:
                recurs = false;
                break;
            case ts.SyntaxKind.Constructor:
                break;
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.ModuleDeclaration:
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.InterfaceDeclaration:
            case ts.SyntaxKind.VariableDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
            case ts.SyntaxKind.ClassExpression:
                break;
        }
        popStack = aux(fields[node.kind], node, entry);
        if (recurs) {
            ts.forEachChild(node, makeTag);
        }
        if (popStack) {
            scopeStack.pop();
        }
    }
    function extractLine(pos) {
        var line = source.getLineAndCharacterOfPosition(pos).line;
        return {
            line: line + 1,
            text: escapeStringRegexp(lines[line]),
        };
    }
}
var matchOperatorsRe = /[\/^$]/g;
function escapeStringRegexp(str) {
    return str.replace(matchOperatorsRe, '\\$&');
}
var endingsRe = /(?:\r\n|\r|\n)/;
function splitLines(str) {
    return str.split(endingsRe);
}
main();
//# sourceMappingURL=index.js.map