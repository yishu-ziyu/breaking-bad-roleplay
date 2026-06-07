import fs from 'fs';
import path from 'path';

interface GusEvaluationResult {
  employeeId: string;
  compliance: number;
  securityAlert: boolean;
  message: string;
}

export function gus_evaluate_employee(employee_id: string, compliance: number): GusEvaluationResult {
  const memoryDir = path.join(process.cwd(), 'server', 'agents', 'memory', 'gus');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  let securityAlert = false;
  let message = `Employee ${employee_id} evaluated with compliance rating ${compliance}. Operations running smoothly.`;

  if (compliance < 3) {
    securityAlert = true;
    message = `WARNING: Employee ${employee_id} compliance is dangerously low (${compliance}). Dispatching Mike to secure boundaries and monitor all loose ends.`;
  }

  // Write evaluation records
  const evaluationPath = path.join(memoryDir, 'employee_evaluations.jsonl');
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    employee_id,
    compliance,
    alert_triggered: securityAlert,
    status: securityAlert ? "Critical Review" : "Compliant"
  });
  fs.appendFileSync(evaluationPath, logEntry + '\n');

  return {
    employeeId: employee_id,
    compliance,
    securityAlert,
    message
  };
}
