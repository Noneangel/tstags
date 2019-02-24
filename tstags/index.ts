import * as fs from "fs";
import * as  path from "path";

import * as docopt from "docopt";
import * as glob from "glob";
import * as _ from "lodash";
import * as ts from "typescript";
import { AssertionError } from "assert";

const pkg = require('../package.json')

const USAGE = `\
${ pkg.name } v${ pkg.version }

Usage: tstags [options] [FILE]...

Options:
  -h, --help          show this help message and exit
  -v, --version       show version and exit
  -f, --file [-]      write output to specified file. If file is "-", output is written to standard out
  -R, --recursive     recurse into directories in the file list [default: false]
  --fields <fields>   include selected extension fields
  --list-kinds        list supported languages
  --sort              sort tags [default: false]
  --target <version>  targeting language version [default: ES6]
  --tag-relative      file paths should be relative to the directory containing the tag file [default: false]
`

const fields: {[key: number]: [string, string];} = {}
fields[ts.SyntaxKind.MethodDeclaration] = ['f', 'function']
fields[ts.SyntaxKind.Constructor] = ['o', 'constructor']
fields[ts.SyntaxKind.PropertyDeclaration] = ['m', 'member']
fields[ts.SyntaxKind.GetAccessor] = ['m', 'member']
fields[ts.SyntaxKind.SetAccessor] = ['m', 'member']
fields[ts.SyntaxKind.VariableDeclaration] = ['v', 'variable']
fields[ts.SyntaxKind.FunctionDeclaration] = ['f', 'function']
fields[ts.SyntaxKind.FunctionExpression] = ['f', 'function']
fields[ts.SyntaxKind.ClassDeclaration] = ['c', 'class']
fields[ts.SyntaxKind.ClassExpression] = ['c', 'class']
fields[ts.SyntaxKind.InterfaceDeclaration] = ['i', 'interface']
fields[ts.SyntaxKind.TypeAliasDeclaration] = ['t', 'typealias']
fields[ts.SyntaxKind.EnumDeclaration] = ['e', 'enum']
fields[ts.SyntaxKind.ModuleDeclaration] = ['M', 'module']

const kinds = _.uniq(_.map(_.values(fields), value => value.join('  ')))

const scriptTargets = {
    ES3: ts.ScriptTarget.ES3,
    ES5: ts.ScriptTarget.ES5,
    ES6: ts.ScriptTarget.ES2015,
    Latest: ts.ScriptTarget.Latest,
}

interface TaggingOptions {
    languageVersion?: ts.ScriptTarget
    fields?: string
    tagRelative?: boolean
}

interface TagHeader {
    header: string
    value: string
    help?: string
}

interface TagEntry {
    name?: string
    file?: string
    address?: string
    field?: string
    line?: number,
    extraField?: Field[]
}

class Tags {
    entries: TagEntry[];
    sort: boolean;

    constructor(options?: { sort?: boolean }) {
        options = options || {};
        this.sort = options.sort || false;
        this.entries = [];
    }

    headers(): TagHeader[] {
        const sorted = this.sort ? '1' : '0'
        return [
            { header: '_TAG_FILE_FORMAT', value: '2', help: 'extended format; --format=1 will not append ;" to lines' },
            { header: '_TAG_FILE_SORTED', value: sorted, help: '0=unsorted, 1=sorted, 2=foldcase' },
            { header: '_TAG_PROGRAM_AUTHOR', value: 'Pierre Macherel', help: 'no.way@gmail.com' },
            { header: '_TAG_PROGRAM_NAME', value: 'tstags' },
            { header: '_TAG_PROGRAM_URL', value: 'https://github.com/Perlence/tstags' },
            { header: '_TAG_PROGRAM_VERSION', value: '0.3' },
        ];
    }

    toString(): string {
        return this.writeHeaders().concat(this.writeEntries()).join('\n');
    }

    protected writeHeaders(): string[] {
        return this.headers().map(header =>
            `!${ header.header }\t${ header.value }\t${ header.help || '' }`
        );
    }

    protected writeEntries(): string[] {
        let sorted = this.entries;
        if (this.sort)
            sorted = _.sortBy(this.entries, 'name')
        return sorted.map(entry =>
            `${ entry.name }\t${ entry.file }\t${ entry.address };"\t${ entry.field }\tline:${ entry.line }` +
                (entry.extraField !== undefined ? "\t" + entry.extraField.map((parent) => `${parent.type}:${parent.name}`).join("\t") : "")
        );
    }
}

export function main() {
    const args = docopt.docopt(USAGE, { version: pkg.version })
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

    const names = args['FILE']
    let filenames: string[]
    if (args['--recursive']) {
        // Get all *.ts files recursively in given directories.
        filenames = _(names)
            .map(dir => glob.sync(path.join(dir, '**', '*.ts')))
            .flatten<string>()
            .value();
    }
    else {
        filenames = names;
    }

    const languageVersion = scriptTargets[args['--target']]
    if (languageVersion == null) {
        console.error('Unsupported language version: ' + args['--target'])
        process.exit(1);
    }

    var tags = new Tags({ sort: args['--sort'] })
    filenames.forEach(filename => {
        const text = fs.readFileSync(filename)
        const source = ts.createSourceFile(filename, text.toString(), languageVersion, false)

        makeTags(tags, source, {
            languageVersion: languageVersion,
            fields: args['--fields'],
            tagRelative: args['--tag-relative'],
        })
    })

    if (!tags.entries.length)
        process.exit(0)

    if (args['--file'] === '-') {
        console.log(tags.toString())
    }
    else {
        const filename = args['--file'] || 'tags';
        fs.writeFileSync(filename, tags.toString())
    }
}

class Field {
    constructor(public name: string, public type: string) {}
}

function makeTags(tags: Tags, source: ts.SourceFile, options: TaggingOptions) {

    const lines = splitLines(source.text)
    const scopeStack:Field[] = [];
    const expressionCounter = {
        func: 1,
        class: 1
    }
    makeTag(source)

    /** dept 1 */
    function getIdentifierName(node: ts.Node): string {
        const res: string[] = [];
        function aux(node: ts.Node) {
            switch (node.kind) {
                case ts.SyntaxKind.Identifier:
                    res.push((<ts.Identifier>node).getText(source));
                    break;
            }
        }
        ts.forEachChild(node, (child) => aux(child));
        if (res.length > 1)
            throw Error("multiple identifier found for node " + JSON.stringify(node));
        if (res.length) {
            return res[0];
        }
        let name = "";
        switch (node.kind) {
            case ts.SyntaxKind.Constructor:
                name = "constructor";
                break;
            case ts.SyntaxKind.FunctionExpression:
                name = "function"; // + expressionCounter.func++;
                break
            case ts.SyntaxKind.ClassExpression:
                name = "class"; // + expressionCounter.class++;
                break
        }
        return name || "anonymous";
    }

    /** dept 1 */
    function getIdentifierPos(node: ts.Node): number {
        function getStartOrPos(node: ts.Node) {
            try {
                return (<ts.Identifier>node).getStart(source);
            }
            catch {
                return node.pos;
            }
        }
        function aux(node: ts.Node) {
            switch (node.kind) {
                case ts.SyntaxKind.Identifier:
                res.push(getStartOrPos(node));
                break;
            }
        }
        const res: number[] = [];
        ts.forEachChild(node, (child) => aux(child));
        if (res.length > 1) throw Error("multiple identifier found for node " + JSON.stringify(node));
        return res.length ? res[0] : getStartOrPos(node); // identifier or node position
    }

    function makeTag(node: ts.Node) {
        // return true if a field was pushed on scopeStack
        function aux(field:[string, string], node: ts.Node, entry: TagEntry): boolean {
            if (field != null && (options.fields == null || options.fields.indexOf(field[0]) >= 0)) {
                entry.name = getIdentifierName(node);
                entry.field = field[0];
                entry.file = options.tagRelative == true ?
                                source.fileName :
                                path.resolve(source.fileName);
    
                const firstLine = extractLine(getIdentifierPos(node));
                entry.address = `/^${ firstLine.text }$/`
                entry.line = firstLine.line
                if (scopeStack.length) {
                    if (!entry.extraField) {
                        entry.extraField = []
                    }
                    entry.extraField.push(scopeStack[scopeStack.length - 1]);
                }
                scopeStack.push(new Field(entry.name, field[1]));
                tags.entries.push(entry);
                return true;
            }
            return false;
        }
        const entry: TagEntry = {}
        let popStack = false;
        let recurs = true;

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

    function extractLine(pos: number): { line: number; text: string } {
        let { line } = source.getLineAndCharacterOfPosition(pos);
        return {
            line: line + 1,
            text: escapeStringRegexp(lines[line]),
        }
    }
}

const matchOperatorsRe = /[\/^$]/g;

function escapeStringRegexp(str: string) {
    return str.replace(matchOperatorsRe,  '\\$&');
}

const endingsRe = /(?:\r\n|\r|\n)/

function splitLines(str:string): string[] {
    return str.split(endingsRe)
}

main();