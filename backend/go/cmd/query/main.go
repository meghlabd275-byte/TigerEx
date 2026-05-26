// Package query - Query Builder
package main

import (
	"fmt"
	"strings"
)

type QueryBuilder struct {
	selectCols []string
	fromTable string
	whereClz []string
	orderCols []string
	limitCnt int
}

func Select(cols ...string) *QueryBuilder {
	return &QueryBuilder{selectCols: cols}
}

func (qb *QueryBuilder) From(table string) *QueryBuilder {
	qb.fromTable = table
	return qb
}

func (qb *QueryBuilder) Where(cond string) *QueryBuilder {
	qb.whereClz = append(qb.whereClz, cond)
	return qb
}

func (qb *QueryBuilder) OrderBy(col string) *QueryBuilder {
	qb.orderCols = append(qb.orderCols, col)
	return qb
}

func (qb *QueryBuilder) Limit(n int) *QueryBuilder {
	qb.limitCnt = n
	return qb
}

func (qb *QueryBuilder) Build() string {
	var sql strings.Builder
	sql.WriteString("SELECT ")
	sql.WriteString(strings.Join(qb.selectCols, ", "))
	sql.WriteString(" FROM ")
	sql.WriteString(qb.fromTable)
	if len(qb.whereClz) > 0 {
		sql.WriteString(" WHERE ")
		sql.WriteString(strings.Join(qb.whereClz, " AND "))
	}
	if qb.limitCnt > 0 {
		sql.WriteString(fmt.Sprintf(" LIMIT %d", qb.limitCnt))
	}
	return sql.String()
}

func main() {
	q := Select("id", "name").From("users").Where("status = 'active'").Limit(10)
	fmt.Println(q.Build())
}