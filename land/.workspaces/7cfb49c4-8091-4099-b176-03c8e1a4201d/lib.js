export function countVowelsInString(str) {
  // Unicode-aware vowel matching including accented characters
  let count = 0;
  for (const char of str) {
    if (/[aeiouáéíóúàèìòùäêïöüãõéèííóóúúýÿœæ]/.test(char)) {
      count++;
    }
  }
  return count;
}

class Counter {
  constructor() {
    this.total = 0;
  }

  add(str) {
    this.total += countVowelsInString(str);
    return this;
  }

  reset() {
    this.total = 0;
    return this;
  }

  get() {
    return this.total;
  }
}

export { Counter };
