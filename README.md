# tstags
Ctags-like generator for TypeScript

## instalation
```
git clone git@github.com:Noneangel/tstags.git
cd tstags
npm run build
npm install -g .
```
## [Tagbar](http://majutsushi.github.io/tagbar/)
add this to your vimrc:
```
let g:tagbar_type_typescript = {
  \ 'ctagsbin' : 'tstags',
  \ 'ctagsargs' : '-f-',
  \ 'kinds': [
    \ 'e:enums:0:1',
    \ 'f:functions:0:1',
    \ 't:typealias:0:1',
    \ 'M:Module:0:1',
    \ 'm:member:0:1',
    \ 'i:interface:0:1',
    \ 'c:class:0:1',
    \ 'o:constructor:0:1',
    \ 'v:variable:0:1',
  \ ],
  \ 'kind2scope': {
    \ 'e' : 'enum',
    \ 'f' : 'function',
    \ 't' : 'typealias',
    \ 'M' : 'module',
    \ 'm' : 'member',
    \ 'i' : 'interface',
    \ 'c' : 'class',
    \ 'o' : 'constructor',
    \ 'v' : 'variable',
  \ },
  \ 'sort' : 0,
  \ 'sro' : '.',
\ }
```
