fn main() {
    let w = "do set-being on the being bfc3fb551043071b556353b35706f7720483a0d586b82aaa7df0a08d67a2df59 with field: defaultAble, value: scribe.";
    let nodes = treeword::parse(w);
    println!("nodes: {}", nodes.len());
    for n in &nodes {
        println!("{}", treehash::stringify(n));
    }
}
