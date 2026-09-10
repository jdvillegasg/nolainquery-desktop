import type { AppDAGFile } from './DAGEditor';

import ex01 from '../../examples/dags/what-is-the-monthovermonth-revenue-growth-rate-for-united-kingdom-in-2010.dag.json';
import ex02 from '../../examples/dags/calculate-the-7day-rolling-average-of-revenue-for-australia.dag.json';
import ex03 from '../../examples/dags/calculate-the-customer-churn-rate-between-2009-and-2010.dag.json';
import ex04 from '../../examples/dags/cumulative-revenue-share-of-the-top-20-of-customers.dag.json';
import ex05 from '../../examples/dags/which-products-account-for-the-top-80-of-revenue.dag.json';
import ex06 from '../../examples/dags/gini-coefficient-of-revenue-distribution-in-2010.dag.json';
import ex07 from '../../examples/dags/calculate-the-95th-percentile-of-transaction-values-for-united-kingdom.dag.json';
import ex08 from '../../examples/dags/identify-whale-customers-in-spain-99th-percentile-spend.dag.json';
import ex09 from '../../examples/dags/standard-deviation-of-daily-revenue-in-december-2009.dag.json';
import ex10 from '../../examples/dags/correlation-between-price-and-quantity-for-top-100-products-in-united-kingdom.dag.json';
import ex11 from '../../examples/dags/identify-dormant-customers-who-havent-purchased-since-july-2010.dag.json';
import ex12 from '../../examples/dags/average-time-in-days-between-orders-for-customers-in-united-kingdom.dag.json';
import ex13 from '../../examples/dags/analyze-the-retention-of-spain-customers-across-all-quarters-of-2010.dag.json';
import ex14 from '../../examples/dags/identify-potential-fraudulent-transactions-priceqty-outliers.dag.json';
import ex15 from '../../examples/dags/what-is-the-average-number-of-unique-product-categories-per-customer-per-year.dag.json';

export const EXAMPLE_DAGS: AppDAGFile[] = [
  ex01, ex02, ex03, ex04, ex05,
  ex06, ex07, ex08, ex09, ex10,
  ex11, ex12, ex13, ex14, ex15,
] as AppDAGFile[];
