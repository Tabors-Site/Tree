// examples/parse.rs — a tiny conformance debug CLI: read a Word from stdin, print its canonical IR.
// Lets me diff Rust treeword against the JS parser line-for-line while closing corpus gaps.
//   printf 'When it is dawn, the sun rises, and it becomes day.' | cargo run -q --example parse
use std::io::Read;

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).expect("read stdin");
    let s = s.strip_suffix('\n').unwrap_or(&s); // drop a single trailing newline (shell echo)
    let ir = treeword::parse(s);
    println!("{}", treehash::canonicalize(&treehash::Json::Arr(ir)));
}
