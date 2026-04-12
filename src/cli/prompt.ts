import { createInterface } from "node:readline";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSelect(
  message: string,
  options: { label: string; value: string }[]
): Promise<string[]> {
  console.log(`\n${message}\n`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`);
  }
  console.log(`  ${options.length + 1}) All of the above`);

  const answer = await ask("\nSelect (comma-separated numbers, e.g. 1,3): ");

  const nums = answer.split(",").map((s) => parseInt(s.trim(), 10));

  // "All" option
  if (nums.includes(options.length + 1)) {
    return options.map((o) => o.value);
  }

  const selected = nums
    .filter((n) => n >= 1 && n <= options.length)
    .map((n) => options[n - 1].value);

  if (selected.length === 0) {
    console.error("No valid selection. Exiting.");
    process.exit(1);
  }

  return selected;
}

export async function promptConfirm(message: string): Promise<boolean> {
  const answer = await ask(`${message} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
