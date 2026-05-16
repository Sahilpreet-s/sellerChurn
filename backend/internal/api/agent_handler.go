package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// LiveAgentAnalysis streams the LangGraph agent's step events to the frontend.
// GET /api/v1/sellers/:id/agent
//
// Numeric IDs are treated as real IndiaMART GLIDs: the handler fetches live
// scorecard data from the data warehouse and passes it to the Python agent with
// a liveContext block so the LLM prompts include real monthly trends and the
// current date (essential for correct partial-month interpretation).
//
// Alphanumeric IDs (e.g. "S-20001") use the existing synthetic seller flow.
func (st *Store) LiveAgentAnalysis(c *gin.Context) {
	sellerID := c.Param("id")

	var payload []byte

	if isNumericGLID(sellerID) {
		result, err := fetchScorecard(sellerID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		// Embed liveContext inside the seller dict so the Python agent can use it
		// without changing the agent's top-level contract.
		sellerMap := map[string]any{
			"id":            result.Seller.ID,
			"name":          result.Seller.Name,
			"company":       result.Seller.Company,
			"category":      result.Seller.Category,
			"packageType":   result.Seller.PackageType,
			"arr":           result.Seller.ARR,
			"daysToRenewal": result.Seller.DaysToRenewal,
			"priorChurn":    result.Seller.PriorChurn,
			"riskScore":     result.Seller.RiskScore,
			"metrics":       result.Seller.Metrics,
			"callInsights":  []any{}, // nil slice marshals to null; always send empty array
			"liveContext":   result.LiveContext,
		}
		var serErr error
		payload, serErr = json.Marshal(map[string]any{"seller": sellerMap})
		if serErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "serialize failed"})
			return
		}
	} else {
		seller, ok := st.findSeller(sellerID)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "seller not found"})
			return
		}
		// Merge DB call insights so the agent has the full call history.
		dbInsights, _ := st.OutcomeStore.GetCallInsights(sellerID)
		if len(dbInsights) > 0 {
			seller.CallInsights = append(dbInsights, seller.CallInsights...)
		}
		var serErr error
		payload, serErr = json.Marshal(map[string]any{"seller": seller})
		if serErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "serialize failed"})
			return
		}
	}

	resp, err := http.Post(
		st.MLServiceURL+"/agent/analyze/stream",
		"application/json",
		bytes.NewReader(payload),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("agent service unavailable: %v", err)})
		return
	}
	defer resp.Body.Close()

	// Proxy the SSE stream straight through to the frontend.
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Connection", "keep-alive")

	flusher, canFlush := c.Writer.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			c.Writer.Write(buf[:n]) //nolint:errcheck
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			break
		}
	}
}
