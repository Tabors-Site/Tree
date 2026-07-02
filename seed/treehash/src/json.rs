// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Minimal JSON parser → Json. No deps. Enough for fact/act content and the
// conformance vectors. Numbers parse to f64 (ECMAScript's only number type) —
// the canonicalizer re-formats them the way JSON.stringify does. Object entries
// are kept as a Vec (order is irrelevant downstream: the canonicalizer sorts).

#[derive(Clone, Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

/// Parse a complete JSON document.
pub fn parse(input: &str) -> Result<Json, String> {
    let mut p = P {
        c: input.chars().collect(),
        i: 0,
    };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != p.c.len() {
        return Err(format!("unexpected trailing content at {}", p.i));
    }
    Ok(v)
}

struct P {
    c: Vec<char>,
    i: usize,
}

impl P {
    fn peek(&self) -> Option<char> {
        self.c.get(self.i).copied()
    }
    fn bump(&mut self) -> Option<char> {
        let c = self.c.get(self.i).copied();
        if c.is_some() {
            self.i += 1;
        }
        c
    }
    fn ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
                self.i += 1;
            } else {
                break;
            }
        }
    }
    fn expect(&mut self, ch: char) -> Result<(), String> {
        if self.peek() == Some(ch) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("expected {:?} at {}", ch, self.i))
        }
    }
    fn starts_with(&self, s: &str) -> bool {
        let sc: Vec<char> = s.chars().collect();
        self.i + sc.len() <= self.c.len() && self.c[self.i..self.i + sc.len()] == sc[..]
    }

    fn value(&mut self) -> Result<Json, String> {
        self.ws();
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"') => Ok(Json::Str(self.string()?)),
            Some('t') | Some('f') => self.boolean(),
            Some('n') => self.null_lit(),
            Some(c) if c == '-' || c.is_ascii_digit() => self.number(),
            other => Err(format!("unexpected {:?} at {}", other, self.i)),
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect('{')?;
        self.ws();
        let mut out = Vec::new();
        if self.peek() == Some('}') {
            self.i += 1;
            return Ok(Json::Obj(out));
        }
        loop {
            self.ws();
            let key = self.string()?;
            self.ws();
            self.expect(':')?;
            let val = self.value()?;
            out.push((key, val));
            self.ws();
            match self.bump() {
                Some(',') => continue,
                Some('}') => break,
                other => return Err(format!("expected , or }} at {} (got {:?})", self.i, other)),
            }
        }
        Ok(Json::Obj(out))
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect('[')?;
        self.ws();
        let mut out = Vec::new();
        if self.peek() == Some(']') {
            self.i += 1;
            return Ok(Json::Arr(out));
        }
        loop {
            out.push(self.value()?);
            self.ws();
            match self.bump() {
                Some(',') => continue,
                Some(']') => break,
                other => return Err(format!("expected , or ] at {} (got {:?})", self.i, other)),
            }
        }
        Ok(Json::Arr(out))
    }

    fn boolean(&mut self) -> Result<Json, String> {
        if self.starts_with("true") {
            self.i += 4;
            Ok(Json::Bool(true))
        } else if self.starts_with("false") {
            self.i += 5;
            Ok(Json::Bool(false))
        } else {
            Err(format!("bad literal at {}", self.i))
        }
    }

    fn null_lit(&mut self) -> Result<Json, String> {
        if self.starts_with("null") {
            self.i += 4;
            Ok(Json::Null)
        } else {
            Err(format!("bad literal at {}", self.i))
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.i;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' {
                self.i += 1;
            } else {
                break;
            }
        }
        let s: String = self.c[start..self.i].iter().collect();
        s.parse::<f64>().map(Json::Num).map_err(|_| format!("bad number {:?}", s))
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            match self.bump() {
                None => return Err("unterminated string".into()),
                Some('"') => break,
                Some('\\') => match self.bump() {
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('/') => out.push('/'),
                    Some('b') => out.push('\u{0008}'),
                    Some('f') => out.push('\u{000C}'),
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('u') => {
                        let cp = self.hex4()?;
                        if (0xD800..=0xDBFF).contains(&cp) {
                            // high surrogate; pair with the following \uXXXX low surrogate
                            self.expect('\\')?;
                            self.expect('u')?;
                            let lo = self.hex4()?;
                            if !(0xDC00..=0xDFFF).contains(&lo) {
                                return Err("bad low surrogate".into());
                            }
                            let c = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            out.push(char::from_u32(c).ok_or("bad surrogate pair")?);
                        } else {
                            out.push(char::from_u32(cp).ok_or("bad code unit")?);
                        }
                    }
                    other => return Err(format!("bad escape {:?}", other)),
                },
                Some(c) => out.push(c),
            }
        }
        Ok(out)
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.bump().ok_or("short \\u escape")?;
            let d = c.to_digit(16).ok_or_else(|| format!("bad hex {:?}", c))?;
            v = v * 16 + d;
        }
        Ok(v)
    }
}
