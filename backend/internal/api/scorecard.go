package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sellerpulse/internal/models"
)

const scorecardAPIURL = "https://imdwh.intermesh.net/api/go/cust_scorecard_api"

// isNumericGLID reports whether id consists only of ASCII digits.
func isNumericGLID(id string) bool {
	if len(id) == 0 {
		return false
	}
	for i := 0; i < len(id); i++ {
		if id[i] < '0' || id[i] > '9' {
			return false
		}
	}
	return true
}

// ─── External API types ───────────────────────────────────────────────────────

type scorecardRow struct {
	MonthNumber       int     `json:"month_number"`
	BlCons            float64 `json:"bl_cons"`
	BlCreditsAlctd    float64 `json:"bl_credits_alctd"`
	BlActiveDays      float64 `json:"bl_active_days"`
	BlCreditLapsed    float64 `json:"bl_credit_lapsed"`
	PnsSuccessPrcnt   float64 `json:"pns_success_prcnt"`
	Replies           float64 `json:"replies"`
	TotalEnq          float64 `json:"total_enq"`
	CatalogScore      float64 `json:"catalog_score"`
	Cqs               float64 `json:"cqs"`
	Blni              float64 `json:"blni"`
	SuccessConnect    int     `json:"success_connect"`
	LivePrdCnt        int     `json:"live_prd_cnt"`
	ARankMcats        int     `json:"a_rank_mcats"`
	BAndCRankPrimary  int     `json:"b_nd_c_rank_primary"`
	OutgoingAttempted int     `json:"outgoing_call_attempted"`
	OutgoingAnswered  int     `json:"outgoing_call_answered"`
	SalesExecName     string  `json:"sales_exec_name"`
	Service           string  `json:"service"`
}

type scorecardMnth struct {
	MonthNumber     int    `json:"month_number"`
	AttrMonth       string `json:"attr_month"`
	AttrMonthNumber int    `json:"attr_month_number"`
	AttrYear        int    `json:"attr_year"`
}

type scorecardInner struct {
	Summary []scorecardRow  `json:"summary"`
	Mnths   []scorecardMnth `json:"mnths"`
	Daily   []struct {
		TopMcat string `json:"top_10_mcat"`
	} `json:"daily"`
}

type scorecardOuter struct {
	ErrTxt   string `json:"err_txt"`
	Response string `json:"response"`
}

// realSellerResult carries the display seller (for GetSeller) and the extra
// context the Python agent needs for its LLM prompts (for LiveAgentAnalysis).
type realSellerResult struct {
	Seller      models.Seller
	LiveContext map[string]any
}

// ─── Fetch + transform ────────────────────────────────────────────────────────

// fetchScorecard calls the IndiaMART data-warehouse scorecard API and transforms
// the response into a Seller + live context ready for display and agent use.
func fetchScorecard(glid string) (*realSellerResult, error) {
	reqBody, _ := json.Marshal(map[string]string{
		"in_glusr_usr_id": glid,
		"in_rpt_type":     "1",
	})
	resp, err := http.Post(scorecardAPIURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("scorecard API: %w", err)
	}
	defer resp.Body.Close()

	var outer scorecardOuter
	if err := json.NewDecoder(resp.Body).Decode(&outer); err != nil {
		return nil, fmt.Errorf("scorecard decode: %w", err)
	}
	if outer.ErrTxt != "" {
		return nil, fmt.Errorf("scorecard: %s", outer.ErrTxt)
	}

	var inner scorecardInner
	if err := json.Unmarshal([]byte(outer.Response), &inner); err != nil {
		return nil, fmt.Errorf("scorecard inner: %w", err)
	}
	if len(inner.Summary) == 0 {
		return nil, fmt.Errorf("no summary data for GLID %s", glid)
	}

	// Index by month_number (1 = most recent).
	mnthByNum := make(map[int]scorecardMnth, len(inner.Mnths))
	for _, m := range inner.Mnths {
		mnthByNum[m.MonthNumber] = m
	}
	rowByNum := make(map[int]scorecardRow, len(inner.Summary))
	for _, r := range inner.Summary {
		rowByNum[r.MonthNumber] = r
	}

	row1, ok1 := rowByNum[1]
	if !ok1 {
		return nil, fmt.Errorf("no current-month data for GLID %s", glid)
	}
	row2, ok2 := rowByNum[2]
	row3, ok3 := rowByNum[3]

	// Number of days in a complete calendar month.
	fullDays := func(mn scorecardMnth) float64 {
		if mn.AttrYear == 0 || mn.AttrMonthNumber == 0 {
			return 30.0
		}
		// day=0 of the next month == last day of this month.
		t := time.Date(mn.AttrYear, time.Month(mn.AttrMonthNumber+1), 0, 0, 0, 0, 0, time.UTC)
		return float64(t.Day())
	}

	now := time.Now()
	d1 := float64(now.Day()) // elapsed days in the current (partial) month
	var d2, d3 float64
	if ok2 {
		d2 = fullDays(mnthByNum[2])
	}
	if ok3 {
		d3 = fullDays(mnthByNum[3])
	}

	monthLabel := func(num int) string {
		mn, ok := mnthByNum[num]
		if !ok || mn.AttrMonth == "" {
			return ""
		}
		return strings.ToUpper(mn.AttrMonth[:1]) + mn.AttrMonth[1:] + " " + strconv.Itoa(mn.AttrYear)
	}

	// safe: (num/den)*100 capped at 100, rounded to 1 decimal.
	safe := func(num, den float64) float64 {
		if den <= 0 {
			return 0
		}
		v := num / den * 100
		if v > 100 {
			v = 100
		}
		return math.Round(v*10) / 10
	}
	mh := func(month string, val float64) models.MetricHistory {
		return models.MetricHistory{Month: month, Value: val}
	}

	// buildH creates a history slice [oldest … newest] using the three monthly
	// rows. Missing older months are omitted so _latest/_drop still work correctly.
	buildH := func(v3, v2, v1 float64) []models.MetricHistory {
		if ok3 && ok2 {
			return []models.MetricHistory{mh(monthLabel(3), v3), mh(monthLabel(2), v2), mh(monthLabel(1), v1)}
		}
		if ok2 {
			return []models.MetricHistory{mh(monthLabel(2), v2), mh(monthLabel(1), v1)}
		}
		return []models.MetricHistory{mh(monthLabel(1), v1)}
	}

	// loginPct proxy: BL-active days / days in month.
	lp1 := safe(row1.BlActiveDays, d1)
	lp2 := safe(row2.BlActiveDays, d2)
	lp3 := safe(row3.BlActiveDays, d3)

	// blConsumptionPct: BL credits consumed / allocated.
	bc1 := safe(row1.BlCons, row1.BlCreditsAlctd)
	bc2 := safe(row2.BlCons, row2.BlCreditsAlctd)
	bc3 := safe(row3.BlCons, row3.BlCreditsAlctd)

	// pnsPickupRatePct: given directly.
	pns1, pns2, pns3 := row1.PnsSuccessPrcnt, row2.PnsSuccessPrcnt, row3.PnsSuccessPrcnt

	// lmsReplyRatePct: replies / enquiries.
	lms1 := safe(row1.Replies, row1.TotalEnq)
	lms2 := safe(row2.Replies, row2.TotalEnq)
	lms3 := safe(row3.Replies, row3.TotalEnq)

	metrics := models.SellerMetrics{
		LoginPct:               buildH(lp3, lp2, lp1),
		BlConsumptionPct:       buildH(bc3, bc2, bc1),
		PnsPickupRatePct:       buildH(pns3, pns2, pns1),
		LmsReplyRatePct:        buildH(lms3, lms2, lms1),
		RetailBlRecommendedPct: []models.MetricHistory{mh(monthLabel(1), 0)},
		CatalogScore:           buildH(row3.CatalogScore, row2.CatalogScore, row1.CatalogScore),
		Cqs:                    buildH(row3.Cqs, row2.Cqs, row1.Cqs),
		Blni:                   buildH(row3.Blni, row2.Blni, row1.Blni),
		BlActiveDays:           buildH(row3.BlActiveDays, row2.BlActiveDays, row1.BlActiveDays),
	}

	// Top 3 product categories from daily.top_10_mcat ("||"-delimited).
	topCats := ""
	if len(inner.Daily) > 0 && inner.Daily[0].TopMcat != "" {
		parts := strings.Split(inner.Daily[0].TopMcat, "||")
		if len(parts) > 3 {
			parts = parts[:3]
		}
		topCats = strings.Join(parts, ", ")
	}

	seller := models.Seller{
		RawSeller: models.RawSeller{
			ID:          glid,
			Name:        glid,
			Company:     "",
			City:        "",
			Category:    topCats,
			PackageType: row1.Service,
			ARR:         0,
			Status:      "active",
			PriorChurn:  false,
			Metrics:     metrics,
		},
	}

	// Monthly trend rows for the LLM classify/guide prompts (oldest → newest).
	type trendEntry struct {
		Month          string  `json:"month"`
		Enq            float64 `json:"enq"`
		BlCons         float64 `json:"blCons"`
		BlLapsed       float64 `json:"blLapsed"`
		Blni           float64 `json:"blni"`
		SuccessConnect int     `json:"successConnect"`
	}
	var trend []trendEntry
	for _, mn := range []int{3, 2, 1} {
		if r, ok := rowByNum[mn]; ok {
			trend = append(trend, trendEntry{
				Month:          monthLabel(mn),
				Enq:            r.TotalEnq,
				BlCons:         r.BlCons,
				BlLapsed:       r.BlCreditLapsed,
				Blni:           r.Blni,
				SuccessConnect: r.SuccessConnect,
			})
		}
	}

	liveContext := map[string]any{
		"currentDate":           now.Format("2006-01-02"),
		"currentMonth":          monthLabel(1),
		"daysElapsedInMonth":    now.Day(),
		"salesExecName":         row1.SalesExecName,
		"topCategories":         topCats,
		"monthlyTrend":          trend,
		"livePrdCnt":            row1.LivePrdCnt,
		"aRankMcats":            row1.ARankMcats,
		"bAndCRankPrimary":      row1.BAndCRankPrimary,
		"outgoingCallAttempted": row1.OutgoingAttempted,
		"outgoingCallAnswered":  row1.OutgoingAnswered,
	}

	return &realSellerResult{Seller: seller, LiveContext: liveContext}, nil
}
